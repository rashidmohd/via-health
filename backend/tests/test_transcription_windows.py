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
from app.domain.transcript import STEP_MS
from app.workers.transcribe import (
    TransientFailure,
    find_window_work,
    process_session,
    process_windows,
)
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
    assert recording.client.get(f"/sessions/{recording.id}").json()["transcribed_ms"] == STEP_MS

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


# --- plan 0008 A: whole-session speaker refinement -----------------------------------

from app.workers.transcribe import find_refine_work, refine_speakers  # noqa: E402


def refine(worker: Engine, rec: Recording, stt: FakeSttProvider, last_attempt: bool = True) -> str:
    return refine_speakers(
        uuid.UUID(rec.id),
        engine=worker,
        store_for=PostgresObjectStore,
        kms=LocalKmsProvider(),
        stt=stt,
        last_attempt=last_attempt,
    )


def finished_by_windows(recording: Recording, worker: Engine) -> FakeSttProvider:
    chunks = opus_chunks()
    recording.upload(range(0, len(chunks)), chunks)
    recording.finish(len(chunks))
    stt = FakeSttProvider()
    assert final(worker, recording, stt) == "transcribed"
    return stt


def speakers_and_texts(recording: Recording) -> list[tuple[str, str]]:
    transcript = recording.client.get(f"/sessions/{recording.id}/transcript").json()
    return [(s["speaker"], s["text"]) for s in transcript["segments"]]


def test_refinement_corrects_window_labels(recording: Recording, worker: Engine) -> None:
    stt = finished_by_windows(recording, worker)
    before = speakers_and_texts(recording)
    assert before == [("1", "hallo"), ("2", "danke")] * 3
    transcript = recording.client.get(f"/sessions/{recording.id}/transcript").json()
    assert transcript["refine_status"] == "pending"
    assert find_refine_work(worker) == [uuid.UUID(recording.id)]

    # Whole-session diarization says the middle minute was the other way round.
    def ref(label: str, start_s: float, text: str) -> Word:
        return Word(label, int(start_s * 1000), int(start_s * 1000) + 400, text)

    stt.diarized_words = [
        ref("X", 12, "hallo"), ref("Y", 30, "danke"),
        ref("Y", 40, "hallo"), ref("X", 58, "danke"),
        ref("X", 83, "hallo"), ref("Y", 101, "danke"),
    ]  # fmt: skip
    assert refine(worker, recording, stt) == "done"
    assert speakers_and_texts(recording) == [
        ("1", "hallo"), ("2", "danke hallo"), ("1", "danke hallo"), ("2", "danke"),
    ]  # fmt: skip
    after = recording.client.get(f"/sessions/{recording.id}/transcript").json()
    assert after["refine_status"] == "done"
    assert find_refine_work(worker) == []
    assert refine(worker, recording, stt) == "skipped"  # idempotent


def test_refinement_failure_keeps_labels(recording: Recording, worker: Engine) -> None:
    finished_by_windows(recording, worker)
    before = speakers_and_texts(recording)

    class Broken(FakeSttProvider):
        def diarize_words(self, audio: bytes, **kwargs: Any) -> list[Word]:
            raise SttError("InvalidArgument", retryable=False)

    assert refine(worker, recording, Broken()) == "failed"
    assert speakers_and_texts(recording) == before
    transcript = recording.client.get(f"/sessions/{recording.id}/transcript").json()
    assert transcript["refine_status"] == "failed"


def test_refinement_retries_transient_errors(recording: Recording, worker: Engine) -> None:
    finished_by_windows(recording, worker)

    class Flaky(FakeSttProvider):
        def diarize_words(self, audio: bytes, **kwargs: Any) -> list[Word]:
            raise SttError("ServiceUnavailable", retryable=True)

    with pytest.raises(TransientFailure):
        refine(worker, recording, Flaky(), last_attempt=False)
    transcript = recording.client.get(f"/sessions/{recording.id}/transcript").json()
    assert transcript["refine_status"] == "pending"


def test_batch_transcripts_need_no_refinement(
    recording: Recording, worker: Engine, owner: Engine
) -> None:
    class BrokenWindows(FakeSttProvider):
        def recognize_window(self, audio_wav: bytes, *, language: str) -> list[Word]:
            raise SttError("InvalidArgument", retryable=False)

    chunks = opus_chunks()
    recording.upload(range(0, len(chunks)), chunks)
    recording.finish(len(chunks))
    assert final(worker, recording, BrokenWindows()) == "transcribed"
    transcript = recording.client.get(f"/sessions/{recording.id}/transcript").json()
    assert transcript["refine_status"] == "skipped"
    assert find_refine_work(worker) == []


def test_withdrawn_consent_skips_refinement(recording: Recording, worker: Engine) -> None:
    finished_by_windows(recording, worker)
    detail = recording.client.get(f"/clients/{recording.client_id}").json()
    consent = next(c for c in detail["consents"] if c["kind"] == "ai_processing")
    recording.client.post(f"/consents/{consent['id']}/withdraw")
    assert refine(worker, recording, FakeSttProvider()) == "skipped"


# --- plan 0008 B: manual corrections ------------------------------------------------


def correct(recording: Recording, **body: Any) -> Any:
    return recording.client.post(
        f"/sessions/{recording.id}/transcript/speakers", json={"correction": body}
    )


def test_corrections_set_swap_undo_and_survive_refinement(
    recording: Recording, worker: Engine
) -> None:
    stt = finished_by_windows(recording, worker)  # 1 hallo, 2 danke, ×3

    response = correct(recording, op="set", at_ms=30_000, speaker="1")  # first "danke" → 1
    assert response.status_code == 200
    assert [s["speaker"] for s in response.json()["segments"]][:2] == ["1", "2"]
    # joins with the following "hallo" (also speaker 1)
    assert response.json()["segments"][0]["text"] == "hallo danke hallo"

    swapped = correct(recording, op="swap_from", at_ms=80_000, a="1", b="2").json()
    assert swapped["corrections"] == 2
    assert swapped["segments"][-2:] == [
        # "hallo" at 83 s is now speaker 2 and joins the "danke" before it
        {
            "speaker": "2",
            "start_ms": 58_000,
            "end_ms": 83_400,
            "text": "danke hallo",
            "excluded": False,
        },
        {
            "speaker": "1",
            "start_ms": 101_000,
            "end_ms": 101_400,
            "text": "danke",
            "excluded": False,
        },
    ]

    # Refinement afterwards changes the base labels, but corrections are applied on top.
    stt.diarized_words = None  # same labels as the windows
    assert refine(worker, recording, stt) == "done"
    after = recording.client.get(f"/sessions/{recording.id}/transcript").json()
    assert after["segments"][0]["text"] == "hallo danke hallo"
    assert after["segments"][-1]["speaker"] == "1"

    undone = recording.client.post(f"/sessions/{recording.id}/transcript/speakers/undo").json()
    assert undone["corrections"] == 1
    assert undone["segments"][-1]["speaker"] == "2"


@pytest.mark.parametrize(
    "body",
    [
        {"op": "set", "at_ms": 0},
        {"op": "rename", "at_ms": 0, "speaker": "1"},
        {"op": "swap_from", "at_ms": -1, "a": "1", "b": "2"},
        {"op": "set", "at_ms": 0, "speaker": ""},
    ],
)
def test_invalid_corrections(recording: Recording, worker: Engine, body: dict[str, Any]) -> None:
    finished_by_windows(recording, worker)
    assert correct(recording, **body).json() == {"code": "invalid_input"}


def test_corrections_need_own_session(
    recording: Recording, worker: Engine, client: TestClient, mail: FakeEmailSender
) -> None:
    finished_by_windows(recording, worker)
    client.cookies.clear()
    login(client, mail, "other@example.com", display_name="O")
    response = client.post(
        f"/sessions/{recording.id}/transcript/speakers",
        json={"correction": {"op": "set", "at_ms": 0, "speaker": "1"}},
    )
    assert response.status_code == 404
