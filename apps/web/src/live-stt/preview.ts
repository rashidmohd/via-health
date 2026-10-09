import { LIVE_STT_VERSION, type LiveSttLanguage } from './version'

/**
 * Live preview controller (plan 0007 part 2). Runs fully separate from the recorder: its own
 * AudioContext, worklet and worker. Any failure here is reported as an event and never touches
 * the recording.
 */

export type PreviewEvent =
  | { type: 'loading'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'partial'; text: string; startMs: number }
  | { type: 'final'; text: string; startMs: number; endMs: number }
  | { type: 'too_slow' }
  | { type: 'error'; code: string }

export function livePreviewSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof WebAssembly !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  )
}

/** A worker with the engine loading or loaded. Events wait in `buffered` until a preview listens. */
interface Engine {
  worker: Worker
  language: LiveSttLanguage
  buffered: PreviewEvent[]
  listener: ((event: PreviewEvent) => void) | null
  /** Pages currently keeping it warm. */
  holds: number
}

/** A released warm engine waits this long for a preview to take it (React runs the page's
 *  cleanup before the live panel's start when the recording begins). */
const RELEASE_DELAY_MS = 5000

function createEngine(language: LiveSttLanguage): Engine {
  // Versioned URLs: a new model version can never be served from an old cache.
  const worker = new Worker(
    `/live-stt-worker.js?base=/live-stt/${LIVE_STT_VERSION}/&lang=${language}&v=${LIVE_STT_VERSION}`,
  )
  const engine: Engine = { worker, language, buffered: [], listener: null, holds: 0 }
  const deliver = (event: PreviewEvent) =>
    engine.listener ? engine.listener(event) : engine.buffered.push(event)
  worker.onmessage = (event: MessageEvent<PreviewEvent | { type: 'stopped' }>) => {
    if (event.data.type !== 'stopped') deliver(event.data)
  }
  worker.onerror = () => deliver({ type: 'error', code: 'engine_failed' })
  return engine
}

let warm: Engine | null = null

/**
 * Starts loading the engine before the recording starts (record page open), so the first
 * words appear without the ~2 s engine start-up. The next `LivePreview.start` in the same
 * language takes it over. The returned function releases it if no preview took it.
 */
export function prewarmLivePreview(language: LiveSttLanguage): () => void {
  if (!livePreviewSupported()) return () => {}
  if (warm && warm.language !== language) {
    warm.worker.terminate()
    warm = null
  }
  warm ??= createEngine(language)
  const mine = warm
  mine.holds++
  let released = false
  return () => {
    if (released) return
    released = true
    setTimeout(() => {
      mine.holds--
      if (warm === mine && mine.holds === 0) {
        mine.worker.terminate()
        warm = null
      }
    }, RELEASE_DELAY_MS)
  }
}

function takeEngine(language: LiveSttLanguage): Engine {
  if (warm && warm.language === language) {
    const engine = warm
    warm = null
    return engine
  }
  return createEngine(language)
}

export class LivePreview {
  private readonly worker: Worker
  private readonly context: AudioContext
  private readonly nodes: AudioNode[]
  private stopped = false

  private constructor(worker: Worker, context: AudioContext, nodes: AudioNode[]) {
    this.worker = worker
    this.context = context
    this.nodes = nodes
  }

  /** `offsetMs`: recording time when the preview starts, so texts line up with the recording. */
  static async start(
    stream: MediaStream,
    offsetMs: number,
    language: LiveSttLanguage,
    onEvent: (event: PreviewEvent) => void,
  ): Promise<LivePreview> {
    const engine = takeEngine(language)
    const { worker } = engine
    engine.listener = onEvent
    engine.buffered.splice(0).forEach(onEvent)

    const context = new AudioContext({ latencyHint: 'interactive' })
    try {
      await context.audioWorklet.addModule(`/live-stt-capture.js?v=${LIVE_STT_VERSION}`)
      const source = context.createMediaStreamSource(stream)
      const capture = new AudioWorkletNode(context, 'live-stt-capture')
      const silent = context.createGain()
      silent.gain.value = 0 // keeps the worklet running without playing the microphone back
      source.connect(capture).connect(silent).connect(context.destination)

      const channel = new MessageChannel()
      capture.port.postMessage({ port: channel.port1 }, [channel.port1])
      worker.postMessage({ type: 'start', port: channel.port2, offsetMs }, [channel.port2])
      return new LivePreview(worker, context, [source, capture, silent])
    } catch (error) {
      worker.terminate()
      void context.close()
      throw error
    }
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.nodes.forEach((node) => node.disconnect())
    void this.context.close().catch(() => {})
    this.worker.postMessage({ type: 'stop' })
    setTimeout(() => this.worker.terminate(), 1000) // let the last sentence come back
  }
}
