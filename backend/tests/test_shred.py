"""Shred job and retention sweep (plan 0015, rules 6 and 10) — real Postgres, worker role."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session as DbSession

from app.adapters.storage.postgres import PostgresObjectStore
from app.workers.shred import find_shred_work, shred_session
from tests.api_helpers import KEYS, FakeEmailSender, login, sign_note
from tests.test_reports import put_content
from tests.test_transcription import record_session, run, worker

__all__ = ["worker"]  # fixture used by name


@pytest.fixture
def therapist(client: TestClient, mail: FakeEmailSender) -> dict[str, str]:
    me = login(client, mail, "therapist@example.com", display_name="T")
    assert client.put("/keys", json=KEYS).status_code == 201
    return me


def shred(worker: Engine, session_id: str, store_for: Any = PostgresObjectStore) -> str:
    return shred_session(uuid.UUID(session_id), engine=worker, store_for=store_for)


def counts(owner: Engine, session_id: str) -> dict[str, Any]:
    with owner.connect() as c:
        one = {"id": session_id}
        return {
            "keys": c.execute(
                text("SELECT count(*) FROM wrapped_keys WHERE session_id = :id"), one
            ).scalar_one(),
            "objects": c.execute(
                text("SELECT count(*) FROM object_blobs WHERE session_id = :id"), one
            ).scalar_one(),
            "audio_state": c.execute(
                text("SELECT audio_state FROM sessions WHERE id = :id"), one
            ).scalar_one(),
        }


def signed_session(client: TestClient, worker: Engine) -> str:
    session_id: str = record_session(client)["session_id"]
    assert run(worker, session_id) == "transcribed"
    report = client.get(f"/sessions/{session_id}/report").json()
    client.put(f"/sessions/{session_id}/report", json=put_content(report))
    sign_note(client, session_id)
    return session_id


def test_signed_session_audio_is_shredded(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = signed_session(client, worker)
    assert counts(owner, session_id)["objects"] == 3  # audio still stored until the job runs
    assert find_shred_work(worker) == [uuid.UUID(session_id)]

    assert shred(worker, session_id) == "shredded"
    assert counts(owner, session_id) == {"keys": 0, "objects": 0, "audio_state": "shredded"}
    # The record stays: the signed note and the (sealed) transcript row.
    assert client.get(f"/sessions/{session_id}/report").json()["status"] == "signed"
    with owner.connect() as c:
        assert c.execute(text("SELECT count(*) FROM transcripts")).scalar_one() == 1
        audit = c.execute(
            text("SELECT meta FROM audit_log WHERE action = 'audio_shredded'")
        ).scalar_one()
    assert audit == {"objects": "3", "reason": "marked"}
    assert find_shred_work(worker) == []


def test_running_twice_is_a_noop(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = signed_session(client, worker)
    assert shred(worker, session_id) == "shredded"
    assert shred(worker, session_id) == "skipped"
    with owner.connect() as c:
        assert (
            c.execute(
                text("SELECT count(*) FROM audit_log WHERE action = 'audio_shredded'")
            ).scalar_one()
            == 1
        )


def test_keys_go_first_and_a_failed_delete_is_retried(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = signed_session(client, worker)

    class Down(PostgresObjectStore):
        def delete_prefix(self, prefix: str) -> int:
            raise RuntimeError("bucket unavailable")

    with pytest.raises(RuntimeError):
        shred(worker, session_id, Down)
    # Crypto-shred already committed: what is left in the bucket is unreadable.
    assert counts(owner, session_id) == {"keys": 0, "objects": 3, "audio_state": "shred_pending"}
    assert find_shred_work(worker) == [uuid.UUID(session_id)]

    assert shred(worker, session_id) == "shredded"
    assert counts(owner, session_id)["objects"] == 0


def test_withdrawn_consent_audio_is_shredded(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    rec = record_session(client)
    detail = client.get(f"/clients/{rec['client_id']}").json()
    consent = next(c for c in detail["consents"] if c["kind"] == "recording")
    client.post(f"/consents/{consent['id']}/withdraw")
    assert counts(owner, rec["session_id"])["audio_state"] == "shred_pending"

    assert shred(worker, rec["session_id"]) == "shredded"
    assert counts(owner, rec["session_id"]) == {"keys": 0, "objects": 0, "audio_state": "shredded"}
    assert client.post(f"/sessions/{rec['session_id']}/retry").status_code == 409


def test_retention_sweep_shreds_only_after_the_deadline(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = record_session(client)["session_id"]
    assert find_shred_work(worker) == []
    assert shred(worker, session_id) == "skipped"  # unsigned, still within 30 days
    assert counts(owner, session_id)["objects"] == 3

    with owner.begin() as c:
        c.execute(
            text(
                "UPDATE sessions SET started_at = now() - interval '31 days', "
                "retention_deadline = now() - interval '1 day' WHERE id = :id"
            ),
            {"id": session_id},
        )
    assert find_shred_work(worker) == [uuid.UUID(session_id)]
    assert shred(worker, session_id) == "shredded"
    assert counts(owner, session_id) == {"keys": 0, "objects": 0, "audio_state": "shredded"}
    with owner.connect() as c:
        reason = c.execute(
            text("SELECT meta->>'reason' FROM audit_log WHERE action = 'audio_shredded'")
        ).scalar_one()
    assert reason == "retention"


def test_leftover_temporary_stt_copies_are_deleted(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = signed_session(client, worker)
    other = record_session(client)["session_id"]
    with owner.begin() as c:
        for key, sid in ((f"stt-tmp/{session_id}-refine", session_id), (f"stt-tmp/{other}", other)):
            c.execute(
                text("INSERT INTO object_blobs (key, session_id, data) VALUES (:k, :s, '\\x00')"),
                {"k": key, "s": sid},
            )
    shred(worker, session_id)
    with owner.connect() as c:
        keys = c.execute(text("SELECT key FROM object_blobs WHERE key LIKE 'stt-tmp/%'")).all()
    assert [k for (k,) in keys] == [f"stt-tmp/{other}"]  # only this session's copies


def test_audio_state_never_moves_back(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = signed_session(client, worker)
    with DbSession(worker) as db, pytest.raises(DBAPIError):
        db.execute(
            text("UPDATE sessions SET audio_state = 'present' WHERE id = :id"), {"id": session_id}
        )
    shred(worker, session_id)
    for state in ("present", "shred_pending"):
        with owner.begin() as c, pytest.raises(DBAPIError):
            c.execute(
                text("UPDATE sessions SET audio_state = :s WHERE id = :id"),
                {"s": state, "id": session_id},
            )
