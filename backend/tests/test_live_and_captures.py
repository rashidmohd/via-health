"""Live text while recording and documentation chips (plan 0007)."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.core.data_crypto import encrypt_json
from app.domain.transcript import STEP_MS
from tests.api_helpers import FakeEmailSender, login
from tests.test_transcription_windows import Recording


@pytest.fixture
def recording(client: TestClient, mail: FakeEmailSender) -> Recording:
    login(client, mail, "t@example.com", display_name="T")
    return Recording(client)


def add_window(owner: Engine, session_id: str, idx: int, words: list[dict[str, Any]]) -> None:
    with owner.begin() as c:
        c.execute(
            text(
                "INSERT INTO transcript_windows (session_id, idx, start_ms, end_ms, words_enc) "
                "VALUES (:s, :i, 0, 0, :w)"
            ),
            {
                "s": session_id,
                "i": idx,
                "w": encrypt_json({"words": words}, f"transcript-window:{session_id}:{idx}"),
            },
        )


def word(speaker: str, start_s: float, txt: str) -> dict[str, Any]:
    start = int(start_s * 1000)
    return {"speaker": speaker, "start_ms": start, "end_ms": start + 300, "text": txt}


def test_live_text_stitches_windows(recording: Recording, owner: Engine) -> None:
    empty = recording.client.get(f"/sessions/{recording.id}/live").json()
    assert empty == {"covered_ms": 0, "segments": []}

    add_window(owner, recording.id, 0, [word("1", 1, "Guten"), word("1", 1.5, "Tag."),
                                        word("2", 44, "Hallo")])  # fmt: skip
    add_window(owner, recording.id, 1, [word("2", 44, "Hallo"), word("2", 50, "zusammen.")])
    live = recording.client.get(f"/sessions/{recording.id}/live").json()
    assert live["covered_ms"] == 2 * STEP_MS
    assert [(s["speaker"], s["text"]) for s in live["segments"]] == [
        ("1", "Guten Tag."),
        ("2", "Hallo zusammen."),
    ]


def test_captures_saved_encrypted_and_idempotent(recording: Recording, owner: Engine) -> None:
    body = {"id": str(uuid.uuid4()), "kind": "action_item", "key": "action_item:61000",
            "at_ms": 61_000, "text": "Gedanken aufschreiben", "status": "confirmed"}  # fmt: skip
    url = f"/sessions/{recording.id}/captures"
    assert recording.client.post(url, json=body).json()["text"] == "Gedanken aufschreiben"
    # Same key again (retry or second decision) updates instead of duplicating.
    again = recording.client.post(
        url, json={**body, "id": str(uuid.uuid4()), "status": "dismissed"}
    )
    assert again.json()["status"] == "dismissed"
    assert [c["status"] for c in recording.client.get(url).json()] == ["dismissed"]

    with owner.connect() as c:
        blob = bytes(c.execute(text("SELECT payload_enc FROM captures")).scalar_one())
    assert b"Gedanken" not in blob


def test_capture_status_update(recording: Recording) -> None:
    url = f"/sessions/{recording.id}/captures"
    created = recording.client.post(
        url,
        json={
            "id": str(uuid.uuid4()),
            "kind": "bookmark",
            "key": "bookmark:5000",
            "at_ms": 5000,
            "status": "suggested",
        },  # fmt: skip
    ).json()
    updated = recording.client.patch(f"/captures/{created['id']}", json={"status": "confirmed"})
    assert updated.json()["status"] == "confirmed"


@pytest.mark.parametrize(
    "change",
    [{"kind": "mood"}, {"kind": "risk"}, {"status": "maybe"}, {"at_ms": -1}],
)
def test_only_documentation_kinds(recording: Recording, change: dict[str, Any]) -> None:
    body = {"id": str(uuid.uuid4()), "kind": "date", "key": "k", "at_ms": 1, "status": "suggested",
            **change}  # fmt: skip
    response = recording.client.post(f"/sessions/{recording.id}/captures", json=body)
    assert response.json() == {"code": "invalid_input"}


def test_other_therapist_sees_nothing(
    recording: Recording, client: TestClient, mail: FakeEmailSender
) -> None:
    client.post(
        f"/sessions/{recording.id}/captures",
        json={
            "id": str(uuid.uuid4()),
            "kind": "bookmark",
            "key": "b:1",
            "at_ms": 1,
            "status": "suggested",
        },  # fmt: skip
    )
    client.cookies.clear()
    login(client, mail, "other@example.com", display_name="O")
    assert client.get(f"/sessions/{recording.id}/live").status_code == 404
    assert client.get(f"/sessions/{recording.id}/captures").status_code == 404
