---
name: offline-recorder
description: Use when building or changing browser audio capture, 10-second chunking, the encrypted IndexedDB buffer, the upload queue, session manifests, crash recovery, or storage-quota handling in apps/web/src/recorder.
---

# Offline-first recorder

Principle: **record locally first; upload is a separate, retryable step.**
Connectivity decides *when* audio reaches the server, never *whether* it is captured.

## Pipeline

1. `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } })`.
2. One `MediaStream`, two consumers:
   - `MediaRecorder` → `audio/webm;codecs=opus`, `audioBitsPerSecond: 32000`, `timeslice: 10000` (archive path).
   - `AudioWorklet` → 16 kHz mono PCM → posted to the live-STT Web Worker (see `live-transcript-preview`).
3. On each `dataavailable`: assign `seq` (0,1,2…), compute SHA-256 of the plaintext, encrypt with the session key (AES-256-GCM, fresh 12-byte IV per chunk, AAD = `session_id|seq`), write to Dexie **before** doing anything else.
4. Upload worker reads unsent chunks in `seq` order, requests a presigned PUT URL (`POST /sessions/{id}/chunks/{seq}/upload-url`), uploads ciphertext, then `POST /sessions/{id}/chunks/{seq}/ack` with checksum + size. Delete the local chunk **only after** the server ack.
5. Stop → final `dataavailable`, flush, then `POST /sessions/{id}/manifest` `{ total_chunks, duration_ms, checksums[] }`.

## Dexie schema

```ts
db.version(1).stores({
  sessions: 'id, clientId, status, startedAt',        // status: recording|stopped|syncing|synced|failed
  chunks:   '[sessionId+seq], sessionId, uploaded',   // { sessionId, seq, iv, ciphertext: Blob, sha256, bytes, createdAt, uploaded: 0|1 }
  outbox:   '++id, kind, sessionId',                  // manifests, acks, consent events made offline
});
```

Session IDs are UUIDv7 generated client-side so sessions can start offline.

## WebM caveat

With `timeslice`, only chunk 0 contains the WebM header; later chunks are not standalone files.
The server must concatenate strictly by `seq`. Never reorder, never drop chunk 0.
If independently playable segments are ever needed, restart the recorder every N minutes instead.

## Retry and idempotency

- Exponential backoff with jitter: 1s, 2s, 4s … capped at 60s. Also retry on the `online` event and on `visibilitychange` → visible.
- No Background Sync on Safari/Firefox — never depend on it.
- Uploads are idempotent per `(session_id, seq)`; re-uploading the same chunk must succeed and not duplicate.

## Failure handling (each needs a test)

| Event | Behaviour |
|---|---|
| Network drops | Keep recording; badge "Offline – saving locally" (warning colour) |
| Network returns | Queue resumes automatically |
| Tab/browser crash | On load, find sessions with `status=recording` → offer "Recover session"; finalise manifest from stored chunks |
| Laptop sleep | `navigator.wakeLock.request('screen')` while recording; on release show warning |
| Mic unplugged | `track.onended` + `devicechange` → loud, immediate alert. Silent audio loss is the worst failure |
| Tab close with unsent data | `beforeunload` prompt; data stays in IndexedDB |
| Write fails (`QuotaExceededError`) | Stop gracefully, alert, never drop audio silently |

## Storage

- Never use localStorage (5 MiB, strings only).
- At onboarding: `await navigator.storage.persist()`.
- Before recording: `navigator.storage.estimate()`; block if free quota < 500 MB.
- App cap: 2 GB unsynced audio; warn well before ("Connect to sync").
- Safari evicts script data after 7 days without user interaction — if unsynced sessions exist, show a persistent banner and recommend installing the PWA.
- Opus 32 kbps ≈ 14.4 MB/hour; normally the buffer holds seconds of audio.

## Consent gate

The record button is enabled only if the cached consent status for the client includes `recording` and `ai_processing` and is not withdrawn. The cache is refreshed whenever online; the server re-checks on every chunk-URL request.

## Performance

Pause the avatar animation while recording. Keep encryption and IndexedDB writes off the main thread where possible (a dedicated Worker). Never block the AudioWorklet.
