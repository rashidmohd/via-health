"""Notification tab (plan 0010): the worker writes one event per state change; the therapist
reads only their own; rows never hold names or text."""

import uuid
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import ProgrammingError

from app.adapters.llm import LlmError
from app.adapters.llm.fake import FakeLlmProvider
from app.adapters.stt.base import SttError
from app.db.session import WORKER_ROLE, make_engine
from app.workers.report import draft_report_unconfigured
from tests.api_helpers import FakeEmailSender, login
from tests.test_reports import draft, setup_session
from tests.test_transcription import record_session, run


@pytest.fixture
def worker(fresh_db_url: str) -> Iterator[Engine]:
    engine = make_engine(fresh_db_url, role=WORKER_ROLE)
    yield engine
    engine.dispose()


@pytest.fixture
def therapist(client: TestClient, mail: FakeEmailSender) -> dict[str, str]:
    return login(client, mail, "therapist@example.com", display_name="Tara Berg")


def kinds(client: TestClient) -> list[str]:
    return [n["kind"] for n in client.get("/notifications").json()["items"]]


def test_transcript_ready_once(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client)
    assert client.get("/notifications").json() == {"items": [], "unread": 0, "notes_to_review": 0}
    run(worker, rec["session_id"])
    run(worker, rec["session_id"])  # second run is a no-op
    body = client.get("/notifications").json()
    assert [n["kind"] for n in body["items"]] == ["transcript_ready"]
    item = body["items"][0]
    assert item["session_id"] == rec["session_id"] and item["client_name"] == "Anna"
    assert item["read"] is False and body["unread"] == 1


def test_transcription_failed(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client)
    broken = MagicMock()
    broken.diarize_words.side_effect = SttError("InvalidArgument", retryable=False)
    broken.recognize_window.side_effect = SttError("InvalidArgument", retryable=False)
    assert run(worker, rec["session_id"], broken) == "failed"
    assert kinds(client) == ["transcription_failed"]


def test_report_events(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    session_id = setup_session(client, owner)
    draft(worker, session_id)
    assert kinds(client) == ["report_ready"]
    assert client.get("/notifications").json()["notes_to_review"] == 1

    def down(system: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
        raise LlmError("api_error_500", retryable=False)

    client.post(f"/sessions/{session_id}/report/draft", json={})
    draft(worker, session_id, FakeLlmProvider(down))
    assert kinds(client) == ["report_failed", "report_ready"]


def test_unconfigured_and_no_consent(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    first = setup_session(client, owner)
    draft_report_unconfigured(worker, uuid.UUID(first))
    assert kinds(client) == ["report_failed"]

    second = setup_session(client, owner)
    client_id = client.get(f"/sessions/{second}").json()["client_id"]
    consent = next(
        c
        for c in client.get(f"/clients/{client_id}").json()["consents"]
        if c["kind"] == "ai_processing"
    )
    client.post(f"/consents/{consent['id']}/withdraw")
    draft(worker, second)
    assert kinds(client)[0] == "report_no_consent"


def test_mark_read(
    client: TestClient, therapist: dict[str, str], owner: Engine, worker: Engine
) -> None:
    a, b = setup_session(client, owner), setup_session(client, owner)
    draft(worker, a)
    draft(worker, b)
    items = client.get("/notifications").json()["items"]
    assert client.post("/notifications/read", json={"ids": [items[0]["id"]]}).status_code == 204
    body = client.get("/notifications").json()
    assert [n["read"] for n in body["items"]] == [True, False] and body["unread"] == 1
    client.post("/notifications/read", json={"all": True})
    assert client.get("/notifications").json()["unread"] == 0


def test_rows_hold_no_names_and_stay_private(
    client: TestClient,
    mail: FakeEmailSender,
    therapist: dict[str, str],
    owner: Engine,
    worker: Engine,
) -> None:
    session_id = setup_session(client, owner)
    draft(worker, session_id)
    with owner.connect() as c:
        row = c.execute(text("SELECT * FROM notifications")).mappings().one()
    assert set(row.keys()) == {"id", "user_id", "kind", "session_id", "created_at", "read_at"}
    with worker.connect() as c, pytest.raises(ProgrammingError):
        c.execute(text("SELECT * FROM notifications"))

    client.cookies.clear()
    login(client, mail, "other@example.com", display_name="O")
    assert client.get("/notifications").json()["items"] == []
    client.post("/notifications/read", json={"all": True})
    with owner.connect() as c:
        assert c.execute(text("SELECT read_at FROM notifications")).scalar_one() is None
