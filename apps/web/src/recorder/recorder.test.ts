import { decryptChunk } from './crypto'
import { db } from './db'
import { getVoiceState } from './micMonitor'
import { RecorderError, SessionRecorder, recoverInterrupted } from './recorder'

import { FakeMediaRecorder, installFakeMicrophone } from './testing'

vi.mock('./sync', () => ({ kickSync: vi.fn() }))

describe('SessionRecorder', () => {
  let track: ReturnType<typeof installFakeMicrophone>

  beforeEach(async () => {
    await db.sessions.clear()
    await db.chunks.clear()
    track = installFakeMicrophone()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('saves every slice encrypted on the device, then stops cleanly', async () => {
    const recorder = await SessionRecorder.start({ id: 'c1', name: 'Anna' }, { onProblem: vi.fn() })
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
    const recorder = await SessionRecorder.start({ id: 'c1', name: 'Anna' }, { onProblem: vi.fn() })
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
    await SessionRecorder.start({ id: 'c1', name: 'Anna' }, { onProblem })
    track.onended?.()
    expect(onProblem).toHaveBeenCalledWith('mic_lost')
  })

  it('reports a denied microphone', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn(async () => Promise.reject(new Error('denied')))
    await expect(SessionRecorder.start({ id: 'c1', name: 'A' }, { onProblem: vi.fn() })).rejects.toEqual(
      new RecorderError('mic_denied'),
    )
    expect(await db.sessions.count()).toBe(0)
  })

  it('refuses to start with less than 500 MB free', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ quota: 600e6, usage: 200e6 }) },
    })
    await expect(SessionRecorder.start({ id: 'c1', name: 'A' }, { onProblem: vi.fn() })).rejects.toEqual(
      new RecorderError('storage_low'),
    )
  })

  it('recovers an interrupted session for upload', async () => {
    const recorder = await SessionRecorder.start({ id: 'c1', name: 'Anna' }, { onProblem: vi.fn() })
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
