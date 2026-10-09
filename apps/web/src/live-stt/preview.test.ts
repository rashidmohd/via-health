import type { PreviewEvent } from './preview'

class FakeWorker {
  static all: FakeWorker[] = []
  url: string
  terminated = false
  posted: { type: string }[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeWorker.all.push(this)
  }
  postMessage(message: { type: string }) {
    this.posted.push(message)
  }
  terminate() {
    this.terminated = true
  }
  emit(data: unknown) {
    this.onmessage?.({ data })
  }
}

class FakeNode {
  port = { postMessage: () => {} }
  gain = { value: 1 }
  connect(node: FakeNode) {
    return node
  }
  disconnect() {}
}

class FakeContext {
  destination = new FakeNode()
  audioWorklet = { addModule: async () => {} }
  createMediaStreamSource = () => new FakeNode()
  createGain = () => new FakeNode()
  close = async () => {}
}

async function load() {
  vi.resetModules()
  return import('./preview')
}

describe('live preview engine warm-up', () => {
  beforeEach(() => {
    FakeWorker.all = []
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('AudioWorkletNode', FakeNode)
    vi.stubGlobal('MessageChannel', class { port1 = {}; port2 = {} })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('hands the warm engine to the preview, with the events it sent meanwhile', async () => {
    const { prewarmLivePreview, LivePreview } = await load()
    const release = prewarmLivePreview('de')
    FakeWorker.all[0].emit({ type: 'ready' })

    // Recording starts: the page releases first, then the live panel starts (React order).
    release()
    const events: PreviewEvent[] = []
    await LivePreview.start({} as MediaStream, 0, 'de', (event) => events.push(event))

    expect(FakeWorker.all).toHaveLength(1)
    expect(events).toEqual([{ type: 'ready' }])
    expect(FakeWorker.all[0].posted.map((m) => m.type)).toEqual(['start'])
    vi.advanceTimersByTime(10_000)
    expect(FakeWorker.all[0].terminated).toBe(false)
  })

  it('frees the engine when the page closes without recording', async () => {
    const { prewarmLivePreview } = await load()
    prewarmLivePreview('de')()
    vi.advanceTimersByTime(4000)
    expect(FakeWorker.all[0].terminated).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(FakeWorker.all[0].terminated).toBe(true)
  })

  it('keeps one engine while another page still holds it', async () => {
    const { prewarmLivePreview } = await load()
    const first = prewarmLivePreview('en')
    const second = prewarmLivePreview('en')
    expect(FakeWorker.all).toHaveLength(1)
    first()
    vi.advanceTimersByTime(10_000)
    expect(FakeWorker.all[0].terminated).toBe(false)
    second()
    vi.advanceTimersByTime(10_000)
    expect(FakeWorker.all[0].terminated).toBe(true)
  })

  it('starts a fresh engine for another language', async () => {
    const { prewarmLivePreview, LivePreview } = await load()
    prewarmLivePreview('de')
    await LivePreview.start({} as MediaStream, 0, 'en', () => {})
    expect(FakeWorker.all).toHaveLength(2)
    expect(FakeWorker.all[1].url).toContain('lang=en')
  })
})
