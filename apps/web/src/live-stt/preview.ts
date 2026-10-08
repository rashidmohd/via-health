import { LIVE_STT_VERSION } from './version'

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
    onEvent: (event: PreviewEvent) => void,
  ): Promise<LivePreview> {
    const worker = new Worker(`/live-stt-worker.js?base=/live-stt/${LIVE_STT_VERSION}/`)
    worker.onmessage = (event: MessageEvent<PreviewEvent | { type: 'stopped' }>) => {
      if (event.data.type !== 'stopped') onEvent(event.data)
    }
    worker.onerror = () => onEvent({ type: 'error', code: 'engine_failed' })

    const context = new AudioContext()
    try {
      await context.audioWorklet.addModule('/live-stt-capture.js')
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
