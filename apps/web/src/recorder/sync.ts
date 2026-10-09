import { api, ApiError } from '../api/client'
import { emitAvatarEvent } from '../avatar/events'
import { db, type LocalSession } from './db'

/**
 * Upload queue. Local first: a chunk is deleted from the device only after the server
 * confirmed it. Retries with backoff; resumes when the network or the tab comes back.
 */

/** Errors after which retrying cannot help: the session stops syncing and is shown as a problem. */
const FATAL = new Set([
  'consent_missing',
  'audio_not_accepted',
  'client_not_found',
  'client_not_active',
  'session_not_found',
  'session_conflict',
  'key_conflict',
  'chunk_conflict',
  'chunk_out_of_range',
  'chunk_too_large',
  'invalid_input',
])

/** Consent gone: unprocessed audio must be deleted, on this device too (rule 10). */
const DELETE_LOCAL_AUDIO = new Set(['consent_missing', 'audio_not_accepted'])

export type SyncOutcome = 'idle' | 'synced' | 'retry'

async function syncSession(session: LocalSession): Promise<void> {
  const { id } = session
  if (!session.serverCreated) {
    await api(`/sessions`, {
      method: 'POST',
      body: { id, client_id: session.clientId, started_at: session.startedAt, mime_type: session.mimeType },
    })
    await db.sessions.update(id, { serverCreated: true })
  }
  if (!session.keyUploaded) {
    if (!session.rawKey) throw new ApiError('key_missing', 0)
    await api(`/sessions/${id}/key`, {
      method: 'POST',
      body: { key: session.rawKey, therapist_key: session.therapistKey },
    })
    await db.sessions.update(id, { keyUploaded: true, rawKey: undefined, therapistKey: undefined })
  }

  // Bookmarks (documentation chips the therapist set) go up once the session exists.
  const bookmarks = await db.bookmarks.where('sessionId').equals(id).filter((b) => b.uploaded === 0).toArray()
  for (const bookmark of bookmarks) {
    await api(`/sessions/${id}/captures`, {
      method: 'POST',
      body: {
        id: bookmark.id,
        kind: 'bookmark',
        key: `bookmark:${bookmark.atMs}`,
        at_ms: bookmark.atMs,
        status: 'suggested',
      },
    })
    await db.bookmarks.update([id, bookmark.atMs], { uploaded: 1 })
  }

  const chunks = await db.chunks.where('sessionId').equals(id).sortBy('seq')
  for (const chunk of chunks) {
    await api(`/sessions/${id}/chunks/${chunk.seq}`, {
      method: 'PUT',
      bytes: chunk.data,
      headers: {
        'X-Content-SHA256': chunk.sha256,
        'X-Segment': String(chunk.segment ?? 0),
        'X-Segment-Start-Ms': String(chunk.segmentStartMs ?? 0),
      },
    })
    await db.chunks.delete([id, chunk.seq])
  }

  const latest = await db.sessions.get(id)
  if (latest?.status === 'stopped' && !latest.finished) {
    const left = await db.chunks.where('sessionId').equals(id).count()
    if (left === 0) {
      await api(`/sessions/${id}/finish`, {
        method: 'POST',
        body: {
          total_chunks: latest.nextSeq,
          duration_ms: latest.durationMs ?? 0,
          ended_at: latest.endedAt ?? new Date().toISOString(),
        },
      })
      await db.sessions.update(id, { finished: true, status: 'synced' })
      emitAvatarEvent('upload.done')
    }
  }
}

/** One pass over all unsynced sessions. */
export async function runSyncOnce(): Promise<SyncOutcome> {
  const sessions = await db.sessions.where('status').anyOf('recording', 'stopped').toArray()
  if (sessions.length === 0) return 'idle'
  let retry = false
  for (const session of sessions) {
    try {
      await syncSession(session)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'unknown'
      if (FATAL.has(code)) {
        await db.transaction('rw', db.sessions, db.chunks, async () => {
          await db.sessions.update(session.id, { status: 'failed', error: code })
          if (DELETE_LOCAL_AUDIO.has(code)) {
            await db.chunks.where('sessionId').equals(session.id).delete()
            await db.sessions.update(session.id, { rawKey: undefined })
          }
        })
      } else {
        retry = true // offline, server error, logged out: keep the data, try again later
      }
    }
  }
  const pending = await db.sessions.where('status').anyOf('recording', 'stopped').count()
  return retry ? 'retry' : pending > 0 ? 'retry' : 'synced'
}

/** Backoff for attempt n (0-based): 1 s, 2 s, 4 s … capped at 60 s, with jitter. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(60_000, 1000 * 2 ** attempt)
  return Math.round(base / 2 + random() * (base / 2))
}

let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let again = false
let attempt = 0
let started = false

async function loop(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  clearTimeout(timer)
  try {
    do {
      again = false
      const outcome = await runSyncOnce()
      if (outcome === 'retry' && !again) {
        timer = setTimeout(() => void loop(), backoffMs(attempt++))
      } else if (outcome !== 'retry') {
        attempt = 0
      }
    } while (again)
  } finally {
    running = false
  }
}

/** Try to sync now (new chunk saved, network back, tab visible). */
export function kickSync(): void {
  attempt = 0
  void loop()
}

export function startSync(): () => void {
  if (started) return () => {}
  started = true
  const onVisible = () => {
    if (document.visibilityState === 'visible') kickSync()
  }
  window.addEventListener('online', kickSync)
  document.addEventListener('visibilitychange', onVisible)
  kickSync()
  return () => {
    started = false
    clearTimeout(timer)
    window.removeEventListener('online', kickSync)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
