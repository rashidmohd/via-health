"""Transcription worker against a fresh real Postgres, as the restricted worker role."""

import base64
import hashlib
import os
import shutil
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session as DbSession

from app.adapters.kms.local import LocalKmsProvider
from app.adapters.storage.postgres import PostgresObjectStore
from app.adapters.stt.base import Segment, SttError
from app.adapters.stt.base import Word as DomainWord
from app.adapters.stt.fake import FakeSttProvider
from app.adapters.stt.google import GoogleChirp3Provider, words_to_segments
from app.core.audio import cut_to_wav, wav_duration_ms
from app.db.models import Session
from app.db.session import WORKER_ROLE, make_engine
from app.workers.transcribe import TransientFailure, _assemble_audio, find_ready, process_session
from tests.api_helpers import PNG, FakeEmailSender, login

PLAIN_CHUNKS = [b"webm-header+audio-0", b"audio-1", b"audio-2"]


def browser_chunk(key: bytes, session_id: str, seq: int, plaintext: bytes) -> bytes:
    """Same format as apps/web/src/recorder/crypto.ts."""
    iv = os.urandom(12)
    return b"\x01" + iv + AESGCM(key).encrypt(iv, plaintext, f"{session_id}|{seq}".encode())


@pytest.fixture
def worker(fresh_db_url: str) -> Iterator[Engine]:
    engine = make_engine(fresh_db_url, role=WORKER_ROLE)
    yield engine
    engine.dispose()


def record_session(
    client: TestClient,
    *,
    language: str = "de",
    chunks: list[bytes] = PLAIN_CHUNKS,
    segments: list[tuple[int, int]] | None = None,
) -> dict[str, Any]:
    """`segments`: (segment, segment_start_ms) per chunk; None = old clients (no headers)."""
    client_id = client.post(
        "/clients", json={"name": "Anna", "preferred_language": language}
    ).json()["id"]
    client.post(
        f"/clients/{client_id}/consents",
        json={"kinds": ["recording", "ai_processing"], "language": "de", "signature": PNG},
    )
    session_id = str(uuid.uuid4())
    client.post(
        "/sessions",
        json={
            "id": session_id,
            "client_id": client_id,
            "started_at": datetime.now(UTC).isoformat(),
            "mime_type": "audio/webm;codecs=opus",
        },
    )
    key = os.urandom(32)
    client.post(f"/sessions/{session_id}/key", json={"key": base64.b64encode(key).decode()})
    for seq, plain in enumerate(chunks):
        data = browser_chunk(key, session_id, seq, plain)
        headers = {"X-Content-SHA256": hashlib.sha256(data).hexdigest()}
        if segments is not None:
            headers["X-Segment"] = str(segments[seq][0])
            headers["X-Segment-Start-Ms"] = str(segments[seq][1])
        assert (
            client.put(f"/sessions/{session_id}/chunks/{seq}", content=data, headers=headers)
        ).status_code == 204
    finished = client.post(
        f"/sessions/{session_id}/finish",
        json={
            "total_chunks": len(chunks),
            "duration_ms": 30_000,
            "ended_at": datetime.now(UTC).isoformat(),
        },
    ).json()
    assert finished["status"] == "uploaded", finished
    return {"session_id": session_id, "client_id": client_id, "key": key}


def run(worker: Engine, session_id: str, stt: Any = None, last_attempt: bool = True) -> str:
    return process_session(
        uuid.UUID(session_id),
        engine=worker,
        store_for=PostgresObjectStore,
        kms=LocalKmsProvider(),
        stt=stt or FakeSttProvider(),
        last_attempt=last_attempt,
    )


@pytest.fixture
def therapist(client: TestClient, mail: FakeEmailSender) -> dict[str, str]:
    return login(client, mail, "therapist@example.com", display_name="T")


# --- happy path ------------------------------------------------------------------


def test_uploaded_session_is_transcribed(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client)
    assert find_ready(worker) == [uuid.UUID(rec["session_id"])]
    stt = FakeSttProvider()

    assert run(worker, rec["session_id"], stt) == "transcribed"

    assert stt.calls == [
        {
            "bytes": len(b"".join(PLAIN_CHUNKS)),
            "mime_type": "audio/webm;codecs=opus",
            "language": "de-DE",
            "job_id": rec["session_id"],
        }
    ]
    assert client.get(f"/sessions/{rec['session_id']}").json()["status"] == "transcribed"
    transcript = client.get(f"/sessions/{rec['session_id']}/transcript").json()
    assert [s["speaker"] for s in transcript["segments"]] == ["1", "2"]
    assert transcript["segments"][0]["text"].startswith("Hallo")
    assert transcript["therapist_speaker"] is None
    assert find_ready(worker) == []


def test_audio_is_joined_strictly_by_seq(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client)
    captured: dict[str, bytes] = {}

    class Capture(FakeSttProvider):
        def diarize_words(self, audio: bytes, **kwargs: Any) -> list[DomainWord]:
            captured["audio"] = audio
            return super().diarize_words(audio, **kwargs)

    run(worker, rec["session_id"], Capture())
    assert captured["audio"] == b"".join(PLAIN_CHUNKS)


def test_english_client_uses_english_model(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client, language="en")
    stt = FakeSttProvider()
    run(worker, rec["session_id"], stt)
    assert stt.calls[0]["language"] == "en-US"


def test_transcript_encrypted_at_rest(
    client: TestClient, therapist: dict[str, str], worker: Engine, owner: Engine
) -> None:
    rec = record_session(client)
    run(worker, rec["session_id"])
    with owner.connect() as c:
        blob = bytes(c.execute(text("SELECT segments_enc FROM transcripts")).scalar_one())
    assert b"Hallo" not in blob


def test_running_twice_is_a_noop(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client)
    assert run(worker, rec["session_id"]) == "transcribed"
    assert run(worker, rec["session_id"]) == "skipped"


def test_therapist_sets_which_speaker_is_them(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client)
    run(worker, rec["session_id"])
    body = client.patch(
        f"/sessions/{rec['session_id']}/transcript", json={"therapist_speaker": "2"}
    ).json()
    assert body["therapist_speaker"] == "2"


# --- failures ----------------------------------------------------------------------


def test_tampered_chunk_fails_without_transcript(
    client: TestClient, therapist: dict[str, str], worker: Engine, owner: Engine
) -> None:
    rec = record_session(client)
    with owner.begin() as c:
        c.execute(text("UPDATE object_blobs SET data = 'tampered' WHERE key LIKE '%000001'"))
    stt = FakeSttProvider()
    assert run(worker, rec["session_id"], stt) == "failed"
    assert stt.calls == []
    session = client.get(f"/sessions/{rec['session_id']}").json()
    assert (session["status"], session["failure_reason"]) == ("failed", "chunk_corrupt")
    assert client.get(f"/sessions/{rec['session_id']}/transcript").json() == {
        "code": "transcript_not_ready"
    }


def test_chunk_encrypted_with_other_key_fails(
    client: TestClient, therapist: dict[str, str], worker: Engine, owner: Engine
) -> None:
    rec = record_session(client)
    forged = browser_chunk(os.urandom(32), rec["session_id"], 2, b"forged")
    with owner.begin() as c:
        c.execute(text("UPDATE object_blobs SET data = :d WHERE key LIKE '%000002'"), {"d": forged})
        c.execute(
            text("UPDATE audio_chunks SET sha256 = :h WHERE seq = 2"),
            {"h": hashlib.sha256(forged).hexdigest()},
        )
    assert run(worker, rec["session_id"]) == "failed"
    assert client.get(f"/sessions/{rec['session_id']}").json()["failure_reason"] == "chunk_corrupt"


def test_missing_chunk_fails(
    client: TestClient, therapist: dict[str, str], worker: Engine, owner: Engine
) -> None:
    rec = record_session(client)
    with owner.begin() as c:
        c.execute(text("UPDATE sessions SET total_chunks = 4"))
    assert run(worker, rec["session_id"]) == "failed"
    assert (
        client.get(f"/sessions/{rec['session_id']}").json()["failure_reason"] == "incomplete_upload"
    )


def test_withdrawn_consent_stops_processing(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client)
    detail = client.get(f"/clients/{rec['client_id']}").json()
    consent = next(c for c in detail["consents"] if c["kind"] == "ai_processing")
    client.post(f"/consents/{consent['id']}/withdraw")
    # Withdrawal marks unprocessed audio for deletion; nothing is transcribed.
    stt = FakeSttProvider()
    assert run(worker, rec["session_id"], stt) in ("failed", "skipped")
    assert stt.calls == []
    assert client.get(f"/sessions/{rec['session_id']}/transcript").status_code == 404


def test_transient_stt_error_retries_then_fails(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client)
    flaky = MagicMock()
    flaky.diarize_words.side_effect = SttError("ServiceUnavailable", retryable=True)

    with pytest.raises(TransientFailure):
        run(worker, rec["session_id"], flaky, last_attempt=False)
    assert client.get(f"/sessions/{rec['session_id']}").json()["status"] == "processing"

    assert run(worker, rec["session_id"], flaky, last_attempt=True) == "failed"
    session = client.get(f"/sessions/{rec['session_id']}").json()
    assert session["failure_reason"] == "transcription_failed"


def test_retry_after_failure(client: TestClient, therapist: dict[str, str], worker: Engine) -> None:
    rec = record_session(client)
    broken = MagicMock()
    broken.diarize_words.side_effect = SttError("InvalidArgument", retryable=False)
    run(worker, rec["session_id"], broken)
    assert client.post(f"/sessions/{rec['session_id']}/retry").json()["status"] == "uploaded"
    assert run(worker, rec["session_id"]) == "transcribed"


def test_retry_only_for_failed_sessions(client: TestClient, therapist: dict[str, str]) -> None:
    rec = record_session(client)
    assert client.post(f"/sessions/{rec['session_id']}/retry").json() == {
        "code": "session_not_failed"
    }


# --- access ------------------------------------------------------------------------


def test_worker_cannot_read_client_identity_or_users(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    record_session(client)
    with worker.connect() as c:
        assert c.execute(text("SELECT count(*) FROM sessions")).scalar_one() == 1
        for query in (
            "SELECT identity_enc FROM clients",
            "SELECT email FROM users",
            "SELECT signature_enc FROM consents",
            "SELECT * FROM auth_sessions",
        ):
            with pytest.raises(ProgrammingError), c.begin_nested():
                c.execute(text(query))


def test_other_therapist_cannot_read_transcript(
    client: TestClient, mail: FakeEmailSender, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client)
    run(worker, rec["session_id"])
    client.cookies.clear()
    login(client, mail, "other@example.com", display_name="O")
    assert client.get(f"/sessions/{rec['session_id']}/transcript").json() == {
        "code": "session_not_found"
    }


# --- Chirp 3 adapter (no network) ------------------------------------------------------


class Word:
    def __init__(self, word: str, speaker: str, start: float, end: float) -> None:
        from datetime import timedelta

        self.word, self.speaker_label = word, speaker
        self.start_offset, self.end_offset = timedelta(seconds=start), timedelta(seconds=end)


def test_words_grouped_into_speaker_segments() -> None:
    words = [
        Word("Hallo", "1", 0, 0.4),
        Word("zusammen.", "1", 0.5, 1.0),
        Word("Danke.", "2", 1.2, 1.6),
        Word("Gut.", "1", 2.0, 2.3),
    ]
    assert words_to_segments(words) == [
        Segment("1", 0, 1000, "Hallo zusammen."),
        Segment("2", 1200, 1600, "Danke."),
        Segment("1", 2000, 2300, "Gut."),
    ]


@pytest.mark.parametrize("fails", [False, True])
def test_chirp_temp_audio_always_deleted(fails: bool) -> None:
    from google.api_core import exceptions as gexc  # noqa: TID251 (testing the adapter)

    provider = object.__new__(GoogleChirp3Provider)
    blob = MagicMock()
    blob.name = "stt-tmp/job"
    provider._bucket = MagicMock()
    provider._bucket.blob.return_value = blob
    provider._bucket_name = "bucket"
    provider._batch_recognize = MagicMock(  # type: ignore[method-assign]
        side_effect=gexc.ServiceUnavailable("down") if fails else None,  # type: ignore[no-untyped-call]
        return_value=[Segment("1", 0, 1, "x")],
    )
    if fails:
        with pytest.raises(SttError) as info:
            provider.transcribe(
                b"audio", mime_type="audio/webm;codecs=opus", language="de-DE", job_id="job"
            )
        assert info.value.retryable
    else:
        provider.transcribe(
            b"audio", mime_type="audio/webm;codecs=opus", language="de-DE", job_id="job"
        )
    provider._bucket.blob.assert_called_once_with("stt-tmp/job")
    blob.upload_from_string.assert_called_once_with(b"audio", content_type="audio/webm")
    blob.delete.assert_called_once()


# --- reconnected microphone (ADR 0022) --------------------------------------------


def _opus_webm(seconds: int) -> bytes:
    import subprocess

    return subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "lavfi",
         "-i", f"sine=frequency=440:duration={seconds}",
         "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-f", "webm", "pipe:1"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_segments_are_joined_into_one_file_on_the_recording_clock(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    first, second = _opus_webm(5), _opus_webm(5)
    half = len(first) // 2
    rec = record_session(
        client,
        chunks=[first[:half], first[half:], second],  # seq continues across segments
        segments=[(0, 0), (0, 0), (1, 8_000)],
    )
    with DbSession(worker) as db:
        session = db.get(Session, uuid.UUID(rec["session_id"]))
        assert session is not None
        audio, mime_type = _assemble_audio(db, session, LocalKmsProvider(), PostgresObjectStore(db))
    assert mime_type == "audio/webm;codecs=opus"
    wav = cut_to_wav(bytes(audio), 0, 60_000)
    assert wav is not None and wav_duration_ms(wav) == pytest.approx(13_000, abs=200)


def test_single_segment_is_still_plain_concatenation(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client, segments=[(0, 0)] * len(PLAIN_CHUNKS))
    with DbSession(worker) as db:
        session = db.get(Session, uuid.UUID(rec["session_id"]))
        assert session is not None
        audio, mime_type = _assemble_audio(db, session, LocalKmsProvider(), PostgresObjectStore(db))
    assert bytes(audio) == b"".join(PLAIN_CHUNKS)
    assert mime_type == "audio/webm;codecs=opus"  # the session's own type


def test_undecodable_segment_fails_the_session(
    client: TestClient, therapist: dict[str, str], worker: Engine
) -> None:
    rec = record_session(client, segments=[(0, 0), (1, 10_000), (1, 10_000)])
    assert run(worker, rec["session_id"]) == "failed"
    session = client.get(f"/sessions/{rec['session_id']}").json()
    assert session["failure_reason"] == "audio_undecodable"
