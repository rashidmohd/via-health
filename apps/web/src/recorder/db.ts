import Dexie, { type Table } from 'dexie'

/** Local, on-device state. Audio chunks are stored encrypted only. */

export type LocalSessionStatus = 'recording' | 'stopped' | 'synced' | 'failed'

export interface LocalSession {
  id: string
  clientId: string
  clientName: string
  status: LocalSessionStatus
  startedAt: string
  endedAt?: string
  durationMs?: number
  mimeType: string
  /** Next chunk number; equals the chunk count once stopped. */
  nextSeq: number
  /** Non-extractable; encrypts this session's chunks. */
  key: CryptoKey
  /** Raw key (base64), kept only until the server has stored it (needed after a crash or
   *  an offline start). */
  rawKey?: string
  serverCreated: boolean
  keyUploaded: boolean
  finished: boolean
  /** Error code when sync stopped for good (e.g. consent withdrawn). */
  error?: string
}

export interface LocalChunk {
  sessionId: string
  seq: number
  data: Uint8Array<ArrayBuffer>
  sha256: string
  createdAt: string
}

export interface LocalBookmark {
  sessionId: string
  atMs: number
  /** Client-generated capture id (idempotent upload). */
  id: string
  uploaded: 0 | 1
}

export interface CachedConsent {
  clientId: string
  name: string
  ready: boolean
  updatedAt: string
}

class RecorderDb extends Dexie {
  sessions!: Table<LocalSession, string>
  chunks!: Table<LocalChunk, [string, number]>
  consent!: Table<CachedConsent, string>
  bookmarks!: Table<LocalBookmark, [string, number]>

  constructor() {
    super('sessio-recorder')
    this.version(1).stores({
      sessions: 'id, clientId, status',
      chunks: '[sessionId+seq], sessionId',
      consent: 'clientId',
    })
    this.version(2).stores({
      bookmarks: '[sessionId+atMs], sessionId, uploaded',
    })
  }
}

export const db = new RecorderDb()
