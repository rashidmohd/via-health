import { decryptChunk } from './crypto'
import { db } from './db'
import { getVoiceState } from './micMonitor'
import { RecorderError, SessionRecorder, recoverInterrupted } from './recorder'

import { FakeMediaRecorder, fakeTracks, installFakeMicrophone } from './testing'

vi.mock('./sync', () => ({ kickSync: vi.fn() }))
// Real OpenPGP wrapping is covered in crypto/pgp.test.ts (node environment).
vi.mock('../crypto/pgp', () => ({
  wrapSessionKey: vi.fn(async (_raw: Uint8Array, publicKey: string) => {
    if (publicKey !== PUBLIC_KEY) throw new Error('key_invalid')
    return WRAPPED
  }),
}))

const PUBLIC_KEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----'
const WRAPPED = '-----BEGIN PGP MESSAGE-----'

describe('SessionRecorder', () => {
  let track: ReturnType<typeof installFakeMicrophone>

  beforeEach(async () => {
    await db.sessions.clear()
    await db.chunks.clear()
    track = installFakeMicrophone()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('saves every slice encrypted on the device, then stops cleanly', async () => {
    const recorder = await SessionRecorder.start({ id: 'c1', name: 'Anna' }, { onProblem: vi.fn() }, PUBLIC_KEY)
    const media = FakeMediaRecorder.last!
    expect(media.timeslice).toBe(10_000)
    expect(media.options).toMatchObject({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 })

    let session = await db.sessions.get(recorder.sessionId)
    expect(session?.status).toBe('recording')
    expect(atob(session!.rawKey!)).toHaveLength(32)

    media.emit('slice zero')
    await recorder.stop()

    session = await db.sessions.get(recorder.sessionId)
    expect(session?.status).toBe('stopped')
    expect(session?.nextSeq).toBe(2)
    expect(track.stop).toHaveBeenCalled()

    const chunks = await db.chunks.where('sessionId').equals(recorder.sessionId).sortBy('seq')
    expect(chunks.map((c) => c.seq)).toEqual([0, 1])
    expect(new TextDecoder().decode(chunks[0].data)).not.toContain('slice zero')
    const plain = await decryptChunk(session!.key, recorder.sessionId, 0, chunks[0].data)
    expect(new TextDecoder().decode(plain)).toBe('slice zero')
  })

  it('uses the chosen microphone, and records even when voice detection cannot run', async () => {
    localStorage.setItem('sessio.micDevice', 'usb')
    const recorder = await SessionRecorder.start({ id: 'c1', name: 'Anna' }, { onProblem: vi.fn() }, PUBLIC_KEY)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: 'usb', echoCancellation: false, channelCount: 1 }),
    })
    expect(getVoiceState().status).toBe('unavailable') // jsdom has no AudioContext
    expect(FakeMediaRecorder.last!.state).toBe('recording')
    await recorder.stop()
    expect(getVoiceState().status).toBe('off')
    localStorage.clear()
  })

  it('alerts loudly when the microphone disconnects', async () => {
    const onProblem = vi.fn()
    await SessionRecorder.start({ id: 'c1', name: 'Anna' }, { onProblem }, PUBLIC_KEY)
    track.onended?.()
    expect(onProblem).toHaveBeenCalledWith('mic_lost')
  })

  it('continues in a new segment after the microphone is reconnected (ADR 0022)', async () => {
    const onProblem = vi.fn()
    const onMicReconnected = vi.fn()
    const recorder = await SessionRecorder.start({ id: 'c1', name: 'Anna' }, { onProblem, onMicReconnected }, PUBLIC_KEY)
    const first = FakeMediaRecorder.last!
    first.emit('before')

    track.readyState = 'ended'
    track.onended?.()
    expect(onProblem).toHaveBeenCalledWith('mic_lost')
    expect(first.state).toBe('inactive') // its last slice is kept
    expect(recorder.micLostNow).toBe(true)

    vi.spyOn(recorder, 'elapsedMs').mockReturnValue(42_000)
    expect(await recorder.reconnect()).toBe(true)
    expect(onMicReconnected).toHaveBeenCalledTimes(1)
    expect(recorder.micLostNow).toBe(false)
    const second = FakeMediaRecorder.last!
    expect(second).not.toBe(first)
    expect(second.state).toBe('recording')
    expect(recorder.mediaStream.getAudioTracks()[0]).toBe(fakeTracks[1])

    second.emit('after')
    await recorder.stop()
    const chunks = await db.chunks.where('sessionId').equals(recorder.sessionId).sortBy('seq')
    expect(chunks.map((c) => [c.seq, c.segment, c.segmentStartMs])).toEqual([
      [0, 0, 0], // 'before'
      [1, 0, 0], // first recorder's final slice
      [2, 1, 42_000], // 'after'
      [3, 1, 42_000], // second recorder's final slice
    ])
    expect(fakeTracks[1].stop).toHaveBeenCalled()
  })

  it('reconnects by itself when a microphone appears', async () => {
    const onMicReconnected = vi.fn()
    const recorder = await SessionRecorder.start(
      { id: 'c1', name: 'Anna' },
      { onProblem: vi.fn(), onMicReconnected },
      PUBLIC_KEY,
    )
    track.onended?.()
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
    await vi.waitFor(() => expect(onMicReconnected).toHaveBeenCalledTimes(1))
    await recorder.stop()
  })

  it('keeps the alert when no microphone can be opened', async () => {
    const onMicReconnected = vi.fn()
    const recorder = await SessionRecorder.start(
      { id: 'c1', name: 'Anna' },
      { onProblem: vi.fn(), onMicReconnected },
      PUBLIC_KEY,
    )
    track.onended?.()
    navigator.mediaDevices.getUserMedia = vi.fn(async () => Promise.reject(new Error('NotFoundError')))
    expect(await recorder.reconnect()).toBe(false)
    expect(recorder.micLostNow).toBe(true)
    expect(onMicReconnected).not.toHaveBeenCalled()

    // Stopping while the microphone is lost still saves everything.
    await recorder.stop()
    expect((await db.sessions.get(recorder.sessionId))?.status).toBe('stopped')
  })

  it('reports a denied microphone', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(async () => Promise.reject(new Error('denied')))
    await expect(SessionRecorder.start({ id: 'c1', name: 'A' }, { onProblem: vi.fn() }, PUBLIC_KEY)).rejects.toEqual(
      new RecorderError('mic_denied'),
    )
    expect(await db.sessions.count()).toBe(0)
  })

  it('wraps the session key to the therapist key (plan 0014 step C)', async () => {
    const recorder = await SessionRecorder.start({ id: 'c1', name: 'Anna' }, { onProblem: vi.fn() }, PUBLIC_KEY)
    expect((await db.sessions.get(recorder.sessionId))?.therapistKey).toBe(WRAPPED)
    await recorder.stop()
  })

  it('does not open the microphone without a usable therapist key', async () => {
    await expect(SessionRecorder.start({ id: 'c1', name: 'A' }, { onProblem: vi.fn() }, 'not a key')).rejects.toEqual(
      new RecorderError('keys_missing'),
    )
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(await db.sessions.count()).toBe(0)
  })

  it('refuses to start with less than 500 MB free', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ quota: 600e6, usage: 200e6 }) },
    })
    await expect(SessionRecorder.start({ id: 'c1', name: 'A' }, { onProblem: vi.fn() }, PUBLIC_KEY)).rejects.toEqual(
      new RecorderError('storage_low'),
    )
  })

  it('recovers an interrupted session for upload', async () => {
    const recorder = await SessionRecorder.start({ id: 'c1', name: 'Anna' }, { onProblem: vi.fn() }, PUBLIC_KEY)
    FakeMediaRecorder.last!.emit('a')
    FakeMediaRecorder.last!.emit('b')
    await vi.waitFor(async () => expect((await db.sessions.get(recorder.sessionId))?.nextSeq).toBe(2))
    // Simulate a crash: the tab is gone, the session is still marked as recording.
    await recoverInterrupted(recorder.sessionId)
    const session = await db.sessions.get(recorder.sessionId)
    expect(session?.status).toBe('stopped')
    expect(session?.durationMs).toBe(20_000)
  })
})
