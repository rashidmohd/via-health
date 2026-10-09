import { wrapSessionKey } from '../crypto/pgp'
import { createSessionKey, encryptChunk, sha256Hex, toBase64 } from './crypto'
import { db } from './db'
import { openMicrophone } from './micDevice'
import { startVoiceMonitor, stopVoiceMonitor } from './micMonitor'
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
  /** No therapist key to wrap the session key to (plan 0014 step C). */
  | 'keys_missing'

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
  /** A lost microphone is back (ADR 0022); the recording continues in a new segment. */
  onMicReconnected?: () => void
  onChunkSaved?: (seq: number) => void
}

/** How long a lost microphone's recorder may take to hand over its last slice. */
const FLUSH_TIMEOUT_MS = 3_000

export class SessionRecorder {
  readonly sessionId: string
  readonly startedAt: number
  private seq = 0
  private writes: Promise<void> = Promise.resolve()
  private wakeLock: WakeLockSentinel | null = null
  private stopped = false
  private readonly key: CryptoKey
  private readonly mimeType: string
  private readonly events: RecorderEvents
  // A reconnected microphone gets a new MediaRecorder = a new segment (ADR 0022).
  private media!: MediaRecorder
  private stream!: MediaStream
  private segment = -1
  /** Set while the microphone is lost: resolves once the old recorder's last slice is queued. */
  private lost: Promise<void> | null = null
  private reconnecting: Promise<boolean> | null = null
  private readonly onDeviceChange = () => void this.reconnect()

  private constructor(sessionId: string, key: CryptoKey, mimeType: string, events: RecorderEvents) {
    this.sessionId = sessionId
    this.key = key
    this.mimeType = mimeType
    this.events = events
    this.startedAt = Date.now()
  }

  /** `therapistPublicKey`: the session key is also wrapped to it, so the audio stays readable
   *  to the therapist after the server's processing key is destroyed at signing (plan 0014). */
  static async start(
    client: { id: string; name: string },
    events: RecorderEvents,
    therapistPublicKey: string,
  ): Promise<SessionRecorder> {
    const mimeType = pickMimeType()
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) throw new RecorderError('unsupported')
    if (!(await hasEnoughStorage())) throw new RecorderError('storage_low')
    void navigator.storage?.persist?.()

    // Before the microphone opens, so a key problem never leaves a half-started recording.
    const { raw, key } = await createSessionKey()
    let therapistKey: string
    try {
      therapistKey = await wrapSessionKey(raw, therapistPublicKey)
    } catch {
      throw new RecorderError('keys_missing')
    }

    let stream: MediaStream
    try {
      stream = await openMicrophone()
    } catch {
      throw new RecorderError('mic_denied')
    }

    const sessionId = uuidv7()
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
      therapistKey,
      serverCreated: false,
      keyUploaded: false,
      finished: false,
    })

    const recorder = new SessionRecorder(sessionId, key, mimeType, events)
    await recorder.holdWakeLock()
    recorder.begin(stream)
    kickSync()
    return recorder
  }

  /** Start a segment on `stream`: its own MediaRecorder, starting at the current recording time. */
  private begin(stream: MediaStream): void {
    const segment = ++this.segment
    const segmentStartMs = segment === 0 ? 0 : this.elapsedMs()
    const media = new MediaRecorder(stream, { mimeType: this.mimeType, audioBitsPerSecond: 32_000 })
    media.ondataavailable = (event) => this.enqueue(event.data, segment, segmentStartMs)
    for (const track of stream.getAudioTracks()) {
      track.onended = () => this.micLost(media)
    }
    this.media = media
    this.stream = stream
    media.start(SLICE_MS)
    void startVoiceMonitor(stream) // voice activity + mic health; failures never affect recording
  }

  /** The microphone of `media` ended: keep its last slice, alert, and watch for a microphone. */
  private micLost(media: MediaRecorder): void {
    if (this.stopped || media !== this.media || this.lost) return
    stopVoiceMonitor()
    this.lost = new Promise<void>((resolve) => {
      // Some browsers stop the recorder by themselves when the track ends; wait for its 'stop'.
      const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS)
      media.addEventListener('stop', () => (clearTimeout(timer), resolve()), { once: true })
      if (media.state !== 'inactive') media.stop()
    })
    this.events.onProblem('mic_lost')
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange)
  }

  get micLostNow(): boolean {
    return this.lost !== null
  }

  /** Open a microphone again after it was lost and continue in a new segment. Resolves false
   *  if none works (the alert stays). Also runs by itself when a microphone appears. */
  reconnect(): Promise<boolean> {
    if (this.stopped || !this.lost) return Promise.resolve(!this.stopped)
    this.reconnecting ??= this.tryReconnect().finally(() => (this.reconnecting = null))
    return this.reconnecting
  }

  private async tryReconnect(): Promise<boolean> {
    let stream: MediaStream
    try {
      stream = await openMicrophone()
    } catch {
      return false
    }
    if (this.stopped || stream.getAudioTracks().every((track) => track.readyState === 'ended')) {
      stream.getTracks().forEach((track) => track.stop())
      return false
    }
    await this.lost // the old segment's last slice gets its seq first
    if (this.stopped) {
      stream.getTracks().forEach((track) => track.stop())
      return false
    }
    this.stream.getTracks().forEach((track) => track.stop())
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange)
    this.lost = null
    this.begin(stream)
    this.events.onMicReconnected?.()
    return true
  }

  /** The microphone stream, for read-only taps such as the live preview. */
  get mediaStream(): MediaStream {
    return this.stream
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt
  }

  private enqueue(blob: Blob, segment: number, segmentStartMs: number): void {
    this.writes = this.writes.then(() => this.save(blob, segment, segmentStartMs))
  }

  private async save(blob: Blob, segment: number, segmentStartMs: number): Promise<void> {
    if (blob.size === 0) return
    const seq = this.seq++
    try {
      const data = await encryptChunk(this.key, this.sessionId, seq, await blob.arrayBuffer())
      const sha256 = await sha256Hex(data)
      await db.transaction('rw', db.chunks, db.sessions, async () => {
        await db.chunks.add({
          sessionId: this.sessionId,
          seq,
          data,
          sha256,
          segment,
          segmentStartMs,
          createdAt: new Date().toISOString(),
        })
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
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange)
    await this.lost // a lost microphone's last slice
    if (this.media.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        this.media.addEventListener('stop', () => resolve(), { once: true })
        this.media.stop()
      })
    }
    stopVoiceMonitor()
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
