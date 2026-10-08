---
name: transcription-pipeline
description: Use when working on backend workers, the SttProvider adapter, Google Speech-to-Text V2 / Chirp 3, incremental window transcription, batch diarization, chunk reassembly with ffmpeg, the session manifest, or the processing state machine.
---

# Transcription pipeline (server)

Workers run on Railway (CPU only). Models run at Google. Workers orchestrate, decrypt in memory, and call adapters.

## Adapter

```python
class Segment(BaseModel):
    speaker: str | None      # "S1", "S2" — mapped to therapist/client in review
    start_ms: int
    end_ms: int
    text: str

class SttProvider(Protocol):
    async def transcribe_short(self, audio: bytes, *, language: str, phrases: list[str]) -> list[Segment]: ...   # < 60 s
    async def transcribe_batch(self, audio_uri: str, *, language: str, phrases: list[str],
                               diarize: bool, min_speakers: int = 2, max_speakers: int = 2) -> list[Segment]: ...
```

Implementations: `GoogleChirp3Provider` (production + dev) and `FakeSttProvider` (tests, deterministic fixtures).
No `google.cloud.speech` import outside `app/adapters/stt/`.

## Chirp 3 specifics

- Speech-to-Text **V2**, model `chirp_3`, language `de-DE` (or client preferred language), EU regional endpoint.
- Diarization only in `Recognize` / `BatchRecognize`, not streaming.
- `BatchRecognize` reads from a GCS URI: write the reassembled audio to a temp object `stt-tmp/{session_id}.webm` in the EU bucket, delete it right after the call (and in `shred_session`).
- Data logging must be OFF on the project. Verify region and phrase-set support via the locations API (open decision).

## Jobs (Arq)

| Job | Trigger | Does |
|---|---|---|
| `transcribe_window` | every ~3–5 min of new acked chunks | decrypt chunks 0..n in memory, cut the new window (+5 s overlap) via ffmpeg pipes, `transcribe_short` in ≤55 s pieces, store `transcript_windows` (encrypted) |
| `finalize_session` | manifest received and all chunks acked | verify count + checksums, reassemble, `transcribe_batch(diarize=True)`, store `transcripts`, enqueue `draft_report` |
| `draft_report` | after finalize | see `report-generation` |
| `shred_session` | report signed / consent withdrawn | delete objects + temp STT objects, mark shredded (idempotent) |
| `retention_sweep` | hourly cron | shred sessions past `retention_deadline` |

## Reassembly

- Concatenate decrypted chunks strictly by `seq` (chunk 0 holds the WebM header).
- Use ffmpeg via stdin/stdout pipes (`-i pipe:0 ... pipe:1`); never write plaintext to disk.
- Missing chunk → session `status='failed'` with reason `incomplete_upload`; the browser re-uploads from its buffer.

## Window stitching

Windows overlap by 5 s. Merge by timestamps: drop words from the later window whose `start_ms` falls inside the previous window's end. Interim windows are only for progress UI; the final transcript always comes from the batch pass.

## State machine

`recording → uploaded → processing → draft_ready → signed`, plus `failed` (retryable). Transitions only through `app/domain/session_state.py`; every transition writes `audit_log`.

## Timing target (50-min session)

Upload remainder ~2 s, batch STT + diarization a few minutes, LLM ~1 min. Show an honest ETA in the UI.

## Rules

- Decrypt in memory only; zero buffers after use.
- Idempotent jobs keyed by session_id; safe to retry.
- Logs: IDs, durations, byte counts. Never text.
