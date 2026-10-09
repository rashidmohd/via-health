import { mockApi } from '../test-utils'
import { createSessionKey, encryptChunk, sha256Hex, toBase64 } from './crypto'
import { db, type LocalSession } from './db'
import { backoffMs, runSyncOnce } from './sync'

async function addSession(overrides: Partial<LocalSession> = {}): Promise<LocalSession> {
  const { raw, key } = await createSessionKey()
  const session: LocalSession = {
    id: 's1',
    clientId: 'c1',
    clientName: 'Anna',
    status: 'recording',
    startedAt: '2026-10-08T10:00:00.000Z',
    mimeType: 'audio/webm;codecs=opus',
    nextSeq: 0,
    key,
    rawKey: toBase64(raw),
    serverCreated: false,
    keyUploaded: false,
    finished: false,
    ...overrides,
  }
  await db.sessions.put(session)
  return session
}

async function addChunks(session: LocalSession, count: number) {
  for (let seq = 0; seq < count; seq++) {
    const data = await encryptChunk(session.key, session.id, seq, new Uint8Array([seq]).buffer)
    await db.chunks.put({ sessionId: session.id, seq, data, sha256: await sha256Hex(data), createdAt: '' })
  }
  await db.sessions.update(session.id, { nextSeq: count })
}

describe('upload queue', () => {
  beforeEach(async () => {
    await db.sessions.clear()
    await db.chunks.clear()
    await db.bookmarks.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('creates the session, sends the key, uploads chunks in order and deletes them after ack', async () => {
    const session = await addSession()
    await addChunks(session, 2)
    const calls = mockApi(() => ({ status: 204 }))

    expect(await runSyncOnce()).toBe('retry') // still recording
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^.*?\/sessions/, '/sessions')}`)).toEqual([
      'POST /sessions',
      'POST /sessions/s1/key',
      'PUT /sessions/s1/chunks/0',
      'PUT /sessions/s1/chunks/1',
    ])
    expect(await db.chunks.count()).toBe(0)
    const stored = await db.sessions.get('s1')
    expect(stored?.rawKey).toBeUndefined()
    expect(stored?.keyUploaded).toBe(true)
  })

  it('sends the therapist-wrapped copy of the key with the raw key (plan 0014 step C)', async () => {
    const session = await addSession({ therapistKey: '-----BEGIN PGP MESSAGE-----' })
    const calls = mockApi(() => ({ status: 204 }))
    await runSyncOnce()
    const keyCall = calls.find((c) => c.url.endsWith('/sessions/s1/key'))
    expect(keyCall?.body).toEqual({ key: session.rawKey, therapist_key: '-----BEGIN PGP MESSAGE-----' })
    expect((await db.sessions.get('s1'))?.therapistKey).toBeUndefined()
  })

  it('finishes a stopped session once every chunk is uploaded', async () => {
    const session = await addSession({ status: 'stopped', durationMs: 20_000, endedAt: '2026-10-08T10:00:20.000Z' })
    await addChunks(session, 2)
    const calls = mockApi(() => ({ status: 200, body: {} }))
    expect(await runSyncOnce()).toBe('synced')
    const finish = calls.find((c) => c.url.endsWith('/finish'))
    expect(finish?.body).toEqual({ total_chunks: 2, duration_ms: 20_000, ended_at: '2026-10-08T10:00:20.000Z' })
    expect((await db.sessions.get('s1'))?.status).toBe('synced')
  })

  it('keeps everything on the device when offline', async () => {
    const session = await addSession()
    await addChunks(session, 2)
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    expect(await runSyncOnce()).toBe('retry')
    expect(await db.chunks.count()).toBe(2)
    expect((await db.sessions.get('s1'))?.rawKey).toBeDefined()
  })

  it('keeps unconfirmed chunks after a server error', async () => {
    const session = await addSession({ serverCreated: true, keyUploaded: true, rawKey: undefined })
    await addChunks(session, 2)
    mockApi((url) => (url.endsWith('/chunks/1') ? { status: 503 } : { status: 204 }))
    expect(await runSyncOnce()).toBe('retry')
    expect((await db.chunks.toArray()).map((c) => c.seq)).toEqual([1])
  })

  it('deletes local audio when consent is gone', async () => {
    const session = await addSession()
    await addChunks(session, 3)
    mockApi(() => ({ status: 409, body: { code: 'consent_missing' } }))
    expect(await runSyncOnce()).toBe('synced')
    const stored = await db.sessions.get('s1')
    expect(stored?.status).toBe('failed')
    expect(stored?.error).toBe('consent_missing')
    expect(stored?.rawKey).toBeUndefined()
    expect(await db.chunks.count()).toBe(0)
  })

  it('uploads bookmarks once the session exists, only once', async () => {
    await addSession()
    await db.bookmarks.put({ sessionId: 's1', atMs: 61_000, id: 'b-1', uploaded: 0 })
    const calls = mockApi(() => ({ status: 200, body: {} }))
    await runSyncOnce()
    const uploads = calls.filter((c) => c.url.endsWith('/sessions/s1/captures'))
    expect(uploads.map((c) => c.body)).toEqual([
      { id: 'b-1', kind: 'bookmark', key: 'bookmark:61000', at_ms: 61_000, status: 'suggested' },
    ])
    expect(calls.findIndex((c) => c.url.endsWith('/captures'))).toBeGreaterThan(
      calls.findIndex((c) => c.url.endsWith('/sessions')),
    )
    await runSyncOnce()
    expect(calls.filter((c) => c.url.endsWith('/captures'))).toHaveLength(1)
  })

  it('backs off exponentially with jitter, capped at 60 s', () => {
    expect(backoffMs(0, () => 0)).toBe(500)
    expect(backoffMs(0, () => 1)).toBe(1000)
    expect(backoffMs(3, () => 1)).toBe(8000)
    expect(backoffMs(20, () => 1)).toBe(60_000)
  })
})
