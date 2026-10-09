import { openMicrophone } from './micDevice'

/** An AudioContext whose analyser reads whatever the stream "delivers". */
function stubAudio(deliver: (stream: MediaStream) => number) {
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = async () => {}
      close = async () => {}
      createMediaStreamSource(stream: MediaStream) {
        return { connect: (analyser: { stream?: MediaStream }) => (analyser.stream = stream) }
      }
      createAnalyser() {
        const analyser = {
          fftSize: 32,
          stream: undefined as MediaStream | undefined,
          getFloatTimeDomainData: (out: Float32Array) => out.fill(deliver(analyser.stream!)),
        }
        return analyser
      }
    },
  )
}

function fakeStream(name: string) {
  const track = { stop: vi.fn() }
  return { name, track, getTracks: () => [track] } as unknown as MediaStream & { name: string; track: { stop: () => void } }
}

describe('openMicrophone (Safari + Bluetooth headset: first stream can be dead)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps a stream that delivers audio', async () => {
    const first = fakeStream('first')
    const getUserMedia = vi.fn(async () => first)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    stubAudio(() => 0.01)
    expect(await openMicrophone()).toBe(first)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('opens the microphone again when the first stream is digital silence', async () => {
    vi.useFakeTimers()
    const first = fakeStream('first')
    const second = fakeStream('second')
    const getUserMedia = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    stubAudio((stream) => ((stream as unknown as { name: string }).name === 'first' ? 0 : 0.01))

    const opened = openMicrophone()
    await vi.advanceTimersByTimeAsync(2000)
    expect(await opened).toBe(second)
    expect(first.track.stop).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
