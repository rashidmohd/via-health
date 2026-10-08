import { createSessionKey, encryptChunk, sha256Hex, toBase64 } from './crypto'
import { db } from './db'
import { kickSync } from './sync'
import { uuidv7 } from './uuidv7'

/** Offline-first recorder (see .claude/skills/offline-recorder). Every 10 s slice is encrypted
 *  and written to IndexedDB before anything else; upload happens separately. */

export const SLICE_MS = 10_000
const MIN_FREE_BYTES = 500 * 1024 * 1024
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4']

export type RecorderProblem =
  | 'unsupported'
  | 'mic_denied'
  | 'mic_lost'
  | 'storage_low'
  | 'storage_full'
  | 'write_failed'

export class RecorderError extends Error {
  readonly problem: RecorderProblem

  constructor(problem: RecorderProblem) {
    super(problem)
    this.problem = problem
  }
}

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

export async function hasEnoughStorage(): Promise<boolean> {
  if (!navigator.storage?.estimate) return true
  const { quota = Infinity, usage = 0 } = await navigator.storage.estimate()
  return quota - usage >= MIN_FREE_BYTES
}

export interface RecorderEvents {
  /** Something that stopped or endangers the recording. Always shown loudly. */
  onProblem: (problem: RecorderProblem) => void
  onChunkSaved?: (seq: number) => void
}

export class SessionRecorder {
  readonly sessionId: string
  readonly startedAt: number
  private seq = 0
  private writes: Promise<void> = Promise.resolve()
  private wakeLock: WakeLockSentinel | null = null
  private stopped = false
  private readonly key: CryptoKey
  private readonly media: MediaRecorder
  private readonly stream: MediaStream
  private readonly events: RecorderEvents

  private constructor(
    sessionId: string,
    key: CryptoKey,
    media: MediaRecorder,
    stream: MediaStream,
    events: RecorderEvents,
  ) {
    this.sessionId = sessionId
    this.key = key
    this.media = media
    this.stream = stream
    this.events = events
    this.startedAt = Date.now()
  }

  static async start(
    client: { id: string; name: string },
    events: RecorderEvents,
  ): Promise<SessionRecorder> {
    const mimeType = pickMimeType()
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) throw new RecorderError('unsupported')
    if (!(await hasEnoughStorage())) throw new RecorderError('storage_low')
    void navigator.storage?.persist?.()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
      })
    } catch {
      throw new RecorderError('mic_denied')
    }

    const sessionId = uuidv7()
    const { raw, key } = await createSessionKey()
    await db.sessions.add({
      id: sessionId,
      clientId: client.id,
      clientName: client.name,
      status: 'recording',
      startedAt: new Date().toISOString(),
      mimeType,
      nextSeq: 0,
      key,
      rawKey: toBase64(raw),
      serverCreated: false,
      keyUploaded: false,
      finished: false,
    })

    const media = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 })
    const recorder = new SessionRecorder(sessionId, key, media, stream, events)
    media.ondataavailable = (event) => recorder.enqueue(event.data)
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (!recorder.stopped) events.onProblem('mic_lost')
      }
    }
    await recorder.holdWakeLock()
    media.start(SLICE_MS)
    kickSync()
    return recorder
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt
  }

  private enqueue(blob: Blob): void {
    this.writes = this.writes.then(() => this.save(blob))
  }

  private async save(blob: Blob): Promise<void> {
    if (blob.size === 0) return
    const seq = this.seq++
    try {
      const data = await encryptChunk(this.key, this.sessionId, seq, await blob.arrayBuffer())
      const sha256 = await sha256Hex(data)
      await db.transaction('rw', db.chunks, db.sessions, async () => {
        await db.chunks.add({ sessionId: this.sessionId, seq, data, sha256, createdAt: new Date().toISOString() })
        await db.sessions.update(this.sessionId, { nextSeq: seq + 1 })
      })
      this.events.onChunkSaved?.(seq)
      kickSync()
    } catch (error) {
      const full = error instanceof DOMException && error.name === 'QuotaExceededError'
      this.events.onProblem(full ? 'storage_full' : 'write_failed')
      if (!this.stopped) void this.stop()
    }
  }

  private async holdWakeLock(): Promise<void> {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
    } catch {
      this.wakeLock = null // not supported or denied; recording still works
    }
  }

  /** Mark the current moment; uploaded with the session as a bookmark chip. */
  async bookmark(): Promise<number> {
    const atMs = this.elapsedMs()
    await db.bookmarks.put({ sessionId: this.sessionId, atMs, id: crypto.randomUUID(), uploaded: 0 })
    kickSync()
    return atMs
  }

  /** Stop, wait for the last slice to be saved, mark the session ready to finish. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    const durationMs = this.elapsedMs()
    if (this.media.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        this.media.addEventListener('stop', () => resolve(), { once: true })
        this.media.stop()
      })
    }
    await this.writes
    this.stream.getTracks().forEach((track) => track.stop())
    await this.wakeLock?.release().catch(() => {})
    await db.sessions.update(this.sessionId, {
      status: 'stopped',
      endedAt: new Date().toISOString(),
      durationMs,
    })
    kickSync()
  }
}

/** After a crash or reload, sessions still marked `recording` were interrupted. */
export async function recoverInterrupted(sessionId: string): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session || session.status !== 'recording') return
  await db.sessions.update(sessionId, {
    status: 'stopped',
    endedAt: new Date().toISOString(),
    durationMs: session.nextSeq * SLICE_MS,
  })
  kickSync()
}
