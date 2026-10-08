"""Sessions: start, key, chunk upload, finish — real Postgres per test."""

import base64
import hashlib
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.adapters.kms import get_kms
from app.core.data_crypto import DecryptionError
from tests.api_helpers import PNG, FakeEmailSender, login

MIME = "audio/webm;codecs=opus"


@pytest.fixture
def therapist(client: TestClient, mail: FakeEmailSender) -> dict[str, str]:
    return login(client, mail, "therapist@example.com", display_name="T")


def make_client(client: TestClient, kinds: tuple[str, ...] = ("recording", "ai_processing")) -> str:
    client_id: str = client.post("/clients", json={"name": "Anna"}).json()["id"]
    if kinds:
        response = client.post(
            f"/clients/{client_id}/consents",
            json={"kinds": list(kinds), "language": "de", "signature": PNG},
        )
        assert response.status_code == 201
    return client_id


def start(client: TestClient, client_id: str, session_id: str | None = None) -> Any:
    return client.post(
        "/sessions",
        json={
            "id": session_id or str(uuid.uuid4()),
            "client_id": client_id,
            "started_at": datetime.now(UTC).isoformat(),
            "mime_type": MIME,
        },
    )


def upload(client: TestClient, session_id: str, seq: int, data: bytes) -> Any:
    return client.put(
        f"/sessions/{session_id}/chunks/{seq}",
        content=data,
        headers={
            "Content-Type": "application/octet-stream",
            "X-Content-SHA256": hashlib.sha256(data).hexdigest(),
        },
    )


def finish(client: TestClient, session_id: str, total: int) -> Any:
    return client.post(
        f"/sessions/{session_id}/finish",
        json={
            "total_chunks": total,
            "duration_ms": total * 10_000,
            "ended_at": datetime.now(UTC).isoformat(),
        },
    )


@pytest.fixture
def ready_session(client: TestClient, therapist: dict[str, str]) -> str:
    response = start(client, make_client(client))
    assert response.status_code == 201, response.text
    session_id: str = response.json()["id"]
    return session_id


# --- start ---------------------------------------------------------------------


def test_start_with_consent(client: TestClient, therapist: dict[str, str]) -> None:
    response = start(client, make_client(client))
    assert response.status_code == 201
    body = response.json()
    assert (body["status"], body["client_name"], body["uploaded_chunks"]) == (
        "recording",
        "Anna",
        0,
    )


@pytest.mark.parametrize("kinds", [(), ("recording",), ("ai_processing",)])
def test_start_without_full_consent_refused(
    client: TestClient, therapist: dict[str, str], kinds: tuple[str, ...]
) -> None:
    response = start(client, make_client(client, kinds))
    assert (response.status_code, response.json()) == (409, {"code": "consent_missing"})


def test_start_is_idempotent(client: TestClient, therapist: dict[str, str]) -> None:
    client_id = make_client(client)
    session_id = str(uuid.uuid4())
    assert start(client, client_id, session_id).status_code == 201
    again = start(client, client_id, session_id)
    assert again.status_code == 201
    assert len(client.get("/sessions").json()) == 1


def test_start_for_other_therapists_client_refused(
    client: TestClient, mail: FakeEmailSender, therapist: dict[str, str]
) -> None:
    client_id = make_client(client)
    client.cookies.clear()
    login(client, mail, "other@example.com", display_name="O")
    assert start(client, client_id).json() == {"code": "client_not_found"}


def test_implausible_start_time_rejected(client: TestClient, therapist: dict[str, str]) -> None:
    response = client.post(
        "/sessions",
        json={
            "id": str(uuid.uuid4()),
            "client_id": make_client(client),
            "started_at": (datetime.now(UTC) - timedelta(days=40)).isoformat(),
            "mime_type": MIME,
        },
    )
    assert response.json() == {"code": "invalid_input"}


# --- session key -----------------------------------------------------------------


def test_session_key_stored_only_wrapped(
    client: TestClient, ready_session: str, owner: Engine
) -> None:
    raw = os.urandom(32)
    body = {"key": base64.b64encode(raw).decode()}
    assert client.post(f"/sessions/{ready_session}/key", json=body).status_code == 204
    assert client.post(f"/sessions/{ready_session}/key", json=body).status_code == 204  # retry
    other = {"key": base64.b64encode(os.urandom(32)).decode()}
    assert client.post(f"/sessions/{ready_session}/key", json=other).json() == {
        "code": "key_conflict"
    }

    with owner.connect() as c:
        wrapped = c.execute(
            text("SELECT ciphertext FROM wrapped_keys WHERE kind = 'processing'")
        ).scalar_one()
    assert raw not in bytes(wrapped)
    aad = f"session:{ready_session}:processing-key"
    assert get_kms().unwrap(bytes(wrapped), aad=aad) == raw
    with pytest.raises(DecryptionError):
        get_kms().unwrap(bytes(wrapped), aad=f"session:{uuid.uuid4()}:processing-key")


def test_session_key_must_be_32_bytes(client: TestClient, ready_session: str) -> None:
    response = client.post(f"/sessions/{ready_session}/key", json={"key": "c2hvcnQ="})
    assert response.json() == {"code": "invalid_input"}


# --- chunks ----------------------------------------------------------------------


def test_upload_stores_ciphertext_and_counts(
    client: TestClient, ready_session: str, owner: Engine
) -> None:
    assert upload(client, ready_session, 0, b"\x01cipher-0").status_code == 204
    assert upload(client, ready_session, 1, b"\x01cipher-1").status_code == 204
    assert client.get("/sessions").json()[0]["uploaded_chunks"] == 2
    with owner.connect() as c:
        rows = c.execute(text("SELECT key, data FROM object_blobs ORDER BY key")).all()
    assert [(r.key, bytes(r.data)) for r in rows] == [
        (f"sessions/{ready_session}/000000", b"\x01cipher-0"),
        (f"sessions/{ready_session}/000001", b"\x01cipher-1"),
    ]


def test_reupload_same_chunk_is_noop_and_different_is_conflict(
    client: TestClient, ready_session: str
) -> None:
    assert upload(client, ready_session, 0, b"same").status_code == 204
    assert upload(client, ready_session, 0, b"same").status_code == 204
    response = upload(client, ready_session, 0, b"different")
    assert (response.status_code, response.json()) == (409, {"code": "chunk_conflict"})


def test_checksum_mismatch_rejected(client: TestClient, ready_session: str) -> None:
    response = client.put(
        f"/sessions/{ready_session}/chunks/0",
        content=b"data",
        headers={"X-Content-SHA256": hashlib.sha256(b"other").hexdigest()},
    )
    assert response.json() == {"code": "checksum_mismatch"}


def test_too_large_chunk_rejected(client: TestClient, ready_session: str) -> None:
    response = upload(client, ready_session, 0, b"x" * 1_000_001)
    assert (response.status_code, response.json()) == (413, {"code": "chunk_too_large"})


def test_chunks_refused_after_consent_withdrawn(client: TestClient, ready_session: str) -> None:
    upload(client, ready_session, 0, b"c0")
    session = client.get("/sessions").json()[0]
    detail = client.get(f"/clients/{session['client_id']}").json()
    recording = next(c for c in detail["consents"] if c["kind"] == "recording")
    client.post(f"/consents/{recording['id']}/withdraw")

    response = upload(client, ready_session, 1, b"c1")
    assert (response.status_code, response.json()) == (409, {"code": "audio_not_accepted"})
    assert client.get("/sessions").json()[0]["audio_state"] == "shred_pending"


def test_unknown_session(client: TestClient, therapist: dict[str, str]) -> None:
    response = upload(client, str(uuid.uuid4()), 0, b"x")
    assert response.json() == {"code": "session_not_found"}


def test_other_therapist_cannot_upload_or_see(
    client: TestClient, mail: FakeEmailSender, ready_session: str
) -> None:
    client.cookies.clear()
    login(client, mail, "other@example.com", display_name="O")
    assert upload(client, ready_session, 0, b"x").json() == {"code": "session_not_found"}
    assert client.get("/sessions").json() == []


# --- finish ----------------------------------------------------------------------


def test_finish_then_last_chunk_completes(client: TestClient, ready_session: str) -> None:
    upload(client, ready_session, 0, b"c0")
    body = finish(client, ready_session, 2).json()
    assert (body["status"], body["total_chunks"], body["uploaded_chunks"]) == ("recording", 2, 1)
    upload(client, ready_session, 1, b"c1")
    assert client.get("/sessions").json()[0]["status"] == "uploaded"


def test_finish_after_all_chunks_completes(client: TestClient, ready_session: str) -> None:
    upload(client, ready_session, 0, b"c0")
    assert finish(client, ready_session, 1).json()["status"] == "uploaded"
    assert finish(client, ready_session, 1).status_code == 200  # retry
    assert finish(client, ready_session, 3).json() == {"code": "session_conflict"}


def test_chunk_beyond_total_rejected(client: TestClient, ready_session: str) -> None:
    finish(client, ready_session, 1)
    assert upload(client, ready_session, 1, b"x").json() == {"code": "chunk_out_of_range"}


def test_list_filtered_by_client(client: TestClient, therapist: dict[str, str]) -> None:
    a, b = make_client(client), make_client(client)
    start(client, a)
    start(client, b)
    listed = client.get("/sessions", params={"client_id": a}).json()
    assert [s["client_id"] for s in listed] == [a]
