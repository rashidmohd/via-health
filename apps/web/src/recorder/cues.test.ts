function stubAudio() {
  const tones: number[] = []
  const created = vi.fn()
  class FakeContext {
    currentTime = 0
    destination = {}
    constructor() {
      created()
    }
    resume = async () => {}
    createOscillator() {
      const osc = {
        type: '',
        frequency: { value: 0 },
        connect: (node: unknown) => node,
        start: () => tones.push(osc.frequency.value),
        stop: () => {},
      }
      return osc
    }
    createGain() {
      const ramp = () => {}
      return {
        gain: { setValueAtTime: ramp, exponentialRampToValueAtTime: ramp },
        connect: (node: unknown) => node,
      }
    }
  }
  vi.stubGlobal('AudioContext', FakeContext)
  return { tones, created }
}

describe('recording cues', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('plays a rising sound on start and a falling one on stop', async () => {
    const { tones, created } = stubAudio()
    const { playCue } = await import('./cues')
    playCue('start')
    expect(tones[0]).toBeLessThan(tones[1])
    tones.length = 0
    playCue('stop')
    expect(tones[0]).toBeGreaterThan(tones[1])
    expect(created).toHaveBeenCalledTimes(1) // one shared context
  })

  it('stays silent when turned off on this device', async () => {
    const { created } = stubAudio()
    localStorage.setItem('sessio.recordSounds', 'off')
    const { playCue } = await import('./cues')
    playCue('start')
    expect(created).not.toHaveBeenCalled()
  })

  it('never throws when audio is unavailable', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('no audio')
        }
      },
    )
    const { playCue } = await import('./cues')
    expect(() => playCue('stop')).not.toThrow()
  })
})
