import { keepRunning } from './audioContext'

class FakeContext extends EventTarget {
  state: string = 'suspended'
  resume = vi.fn(async () => {
    this.state = 'running'
  })
}

describe('keepRunning (Safari suspends contexts created after getUserMedia)', () => {
  it('resumes a suspended context right away', () => {
    const context = new FakeContext()
    keepRunning(context as unknown as AudioContext)
    expect(context.resume).toHaveBeenCalledTimes(1)
  })

  it('resumes again after an interruption and on the next tap', () => {
    const context = new FakeContext()
    context.state = 'running'
    const release = keepRunning(context as unknown as AudioContext)
    expect(context.resume).not.toHaveBeenCalled()

    context.state = 'interrupted'
    context.dispatchEvent(new Event('statechange'))
    expect(context.resume).toHaveBeenCalledTimes(1)

    context.state = 'suspended'
    window.dispatchEvent(new Event('pointerdown'))
    expect(context.resume).toHaveBeenCalledTimes(2)

    release()
    context.state = 'suspended'
    window.dispatchEvent(new Event('pointerdown'))
    context.dispatchEvent(new Event('statechange'))
    expect(context.resume).toHaveBeenCalledTimes(2)
  })

  it('leaves a closed context alone', () => {
    const context = new FakeContext()
    context.state = 'closed'
    keepRunning(context as unknown as AudioContext)
    expect(context.resume).not.toHaveBeenCalled()
  })
})

describe('shared audio context', () => {
  class SharedFake extends FakeContext {
    static created = 0
    closed = false
    audioWorklet = { addModule: vi.fn(async () => {}) }
    constructor() {
      super()
      SharedFake.created++
    }
    close = vi.fn(async () => {
      this.closed = true
    })
  }

  async function load() {
    vi.resetModules()
    SharedFake.created = 0
    vi.stubGlobal('AudioContext', SharedFake)
    return import('./audioContext')
  }
  afterEach(() => vi.unstubAllGlobals())

  const micAt = (sampleRate: number) =>
    ({ getAudioTracks: () => [{ getSettings: () => ({ sampleRate }) }] }) as unknown as MediaStream

  it('shares one context at the microphone rate and closes it after the last user', async () => {
    const { acquireAudioContext } = await load()
    const AudioContextSpy = vi.spyOn(globalThis, 'AudioContext' as never)
    const monitor = acquireAudioContext(micAt(16_000))
    const preview = acquireAudioContext(micAt(16_000))
    expect(SharedFake.created).toBe(1)
    expect(AudioContextSpy).toHaveBeenCalledWith({ latencyHint: 'interactive', sampleRate: 16_000 })
    expect(preview.context).toBe(monitor.context)

    monitor.release()
    monitor.release() // twice is harmless
    expect((preview.context as unknown as SharedFake).closed).toBe(false)
    preview.release()
    expect((preview.context as unknown as SharedFake).closed).toBe(true)
  })

  it('loads each worklet module once per context', async () => {
    const { acquireAudioContext } = await load()
    const a = acquireAudioContext(micAt(48_000))
    await a.addModule('/mic-level.js')
    await acquireAudioContext(micAt(48_000)).addModule('/mic-level.js')
    expect((a.context as unknown as SharedFake).audioWorklet.addModule).toHaveBeenCalledTimes(1)
  })
})
