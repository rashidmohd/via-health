"""Transcription while recording (plan 0006), with real Opus/WebM audio cut by ffmpeg."""

import base64
import hashlib
import os
import shutil
import subprocess
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from functools import cache
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.adapters.kms.local import LocalKmsProvider
from app.adapters.storage.postgres import PostgresObjectStore
from app.adapters.stt.base import SttError, Word
from app.adapters.stt.fake import FakeSttProvider
from app.db.session import WORKER_ROLE, make_engine
from app.workers.transcribe import find_window_work, process_session, process_windows
from tests.api_helpers import PNG, FakeEmailSender, login
from tests.test_transcription import browser_chunk

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")

AUDIO_SECONDS = 125
CHUNKS = 13  # ~9.6 s each, like the browser's 10 s slices


@cache
def opus_chunks() -> list[bytes]:
    audio = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi",
         "-i", f"sine=frequency=440:duration={AUDIO_SECONDS}",
         "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-f", "webm", "pipe:1"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip
    size = -(-len(audio) // CHUNKS)
    return [audio[i : i + size] for i in range(0, len(audio), size)]


@pytest.fixture
def worker(fresh_db_url: str) -> Iterator[Engine]:
    engine = make_engine(fresh_db_url, role=WORKER_ROLE)
    yield engine
    engine.dispose()


class Recording:
    def __init__(self, client: TestClient) -> None:
        self.client = client
        client_id = client.post("/clients", json={"name": "Anna"}).json()["id"]
        client.post(
            f"/clients/{client_id}/consents",
            json={"kinds": ["recording", "ai_processing"], "language": "de", "signature": PNG},
        )
        self.client_id = client_id
        self.id = str(uuid.uuid4())
        client.post(
            "/sessions",
            json={
                "id": self.id,
                "client_id": client_id,
                "started_at": datetime.now(UTC).isoformat(),
                "mime_type": "audio/webm;codecs=opus",
            },
        )
        self.key = os.urandom(32)
        client.post(f"/sessions/{self.id}/key", json={"key": base64.b64encode(self.key).decode()})

    def upload(self, seqs: range, chunks: list[bytes]) -> None:
        for seq in seqs:
            data = browser_chunk(self.key, self.id, seq, chunks[seq])
            response = self.client.put(
                f"/sessions/{self.id}/chunks/{seq}",
                content=data,
                headers={"X-Content-SHA256": hashlib.sha256(data).hexdigest()},
            )
            assert response.status_code == 204, response.text

    def finish(self, total: int, duration_ms: int = AUDIO_SECONDS * 1000) -> dict[str, Any]:
        body: dict[str, Any] = self.client.post(
            f"/sessions/{self.id}/finish",
            json={
                "total_chunks": total,
                "duration_ms": duration_ms,
                "ended_at": datetime.now(UTC).isoformat(),
            },
        ).json()
        return body


@pytest.fixture
def recording(client: TestClient, mail: FakeEmailSender) -> Recording:
    login(client, mail, "t@example.com", display_name="T")
    return Recording(client)


def windows(worker: Engine, rec: Recording, stt: FakeSttProvider) -> str:
    return process_windows(
        uuid.UUID(rec.id),
        engine=worker,
        store_for=PostgresObjectStore,
        kms=LocalKmsProvider(),
        stt=stt,
    )


def final(worker: Engine, rec: Recording, stt: FakeSttProvider) -> str:
    return process_session(
        uuid.UUID(rec.id),
        engine=worker,
        store_for=PostgresObjectStore,
        kms=LocalKmsProvider(),
        stt=stt,
    )


def window_count(owner: Engine) -> int:
    with owner.connect() as c:
        return int(c.execute(text("SELECT count(*) FROM transcript_windows")).scalar_one())


def audit_meta(owner: Engine, action: str) -> Any:
    with owner.connect() as c:
        return c.execute(
            text("SELECT meta FROM audit_log WHERE action = :a"), {"a": action}
        ).scalar_one()


def test_windows_while_recording_then_quick_final(
    recording: Recording, worker: Engine, owner: Engine
) -> None:
    chunks = opus_chunks()
    stt = FakeSttProvider()

    recording.upload(range(0, 5), chunks)  # ~48 s, minus the newest chunk: not enough yet
    assert find_window_work(worker) == []
    assert windows(worker, recording, stt) == "idle"

    recording.upload(range(5, 7), chunks)  # ~67 s → window 0 is complete
    assert find_window_work(worker) == [uuid.UUID(recording.id)]
    assert windows(worker, recording, stt) == "windows"
    assert window_count(owner) == 1
    assert windows(worker, recording, stt) == "idle"  # nothing new
    assert recording.client.get(f"/sessions/{recording.id}").json()["transcribed_ms"] == 48_000

    recording.upload(range(7, len(chunks)), chunks)
    assert recording.finish(len(chunks))["status"] == "uploaded"
    assert final(worker, recording, stt) == "transcribed"

    window_calls = [c for c in stt.calls if "window_bytes" in c]
    batch_calls = [c for c in stt.calls if "mime_type" in c]
    assert len(window_calls) == 3  # 125 s = windows 0, 1, 2; window 0 not repeated
    assert batch_calls == []
    assert audit_meta(owner, "session_transcribed") == {"method": "windows"}
    assert window_count(owner) == 0  # deleted once the transcript exists

    transcript = recording.client.get(f"/sessions/{recording.id}/transcript").json()
    texts = [s["text"] for s in transcript["segments"]]
    assert texts.count("hallo") == 3 and texts.count("danke") == 3
    assert {s["speaker"] for s in transcript["segments"]} <= {"1", "2"}
    starts = [s["start_ms"] for s in transcript["segments"]]
    assert starts == sorted(starts)


def test_short_session_without_windows_is_transcribed_by_windows_at_the_end(
    recording: Recording, worker: Engine, owner: Engine
) -> None:
    chunks = opus_chunks()
    recording.upload(range(0, 3), chunks)
    recording.finish(3, duration_ms=29_000)
    stt = FakeSttProvider()
    assert final(worker, recording, stt) == "transcribed"
    assert audit_meta(owner, "session_transcribed") == {"method": "windows"}


def test_withdrawn_consent_deletes_windows(
    recording: Recording, worker: Engine, owner: Engine
) -> None:
    chunks = opus_chunks()
    recording.upload(range(0, 7), chunks)
    windows(worker, recording, FakeSttProvider())
    assert window_count(owner) == 1

    detail = recording.client.get(f"/clients/{recording.client_id}").json()
    consent = next(c for c in detail["consents"] if c["kind"] == "recording")
    recording.client.post(f"/consents/{consent['id']}/withdraw")

    assert windows(worker, recording, FakeSttProvider()) == "skipped"
    assert window_count(owner) == 0


def test_window_errors_fall_back_to_batch(
    recording: Recording, worker: Engine, owner: Engine
) -> None:
    class BrokenWindows(FakeSttProvider):
        def recognize_window(self, audio_wav: bytes, *, language: str) -> list[Word]:
            raise SttError("InvalidArgument", retryable=False)

    chunks = opus_chunks()
    stt = BrokenWindows()
    recording.upload(range(0, 7), chunks)
    assert windows(worker, recording, stt) == "error"  # recording continues, nothing stored

    recording.upload(range(7, len(chunks)), chunks)
    recording.finish(len(chunks))
    assert final(worker, recording, stt) == "transcribed"
    assert audit_meta(owner, "session_transcribed") == {"method": "batch"}


def test_window_job_after_stop_does_not_store(
    recording: Recording, worker: Engine, owner: Engine
) -> None:
    chunks = opus_chunks()
    recording.upload(range(0, len(chunks)), chunks)
    recording.finish(len(chunks))  # status is now `uploaded`
    assert windows(worker, recording, FakeSttProvider()) == "skipped"
    assert window_count(owner) == 0


def test_worker_role_cannot_read_client_identity_but_windows_work(
    recording: Recording, worker: Engine
) -> None:
    with worker.connect() as c, pytest.raises(Exception, match="permission denied"):
        c.execute(text("SELECT identity_enc FROM clients"))
