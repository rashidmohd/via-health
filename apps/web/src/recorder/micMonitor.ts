import { useSyncExternalStore } from 'react'
import { VoiceDetector } from './vad'

/**
 * Microphone monitor (plan 0011): voice activity + loudness for the avatar ring and mic health.
 * Its own AudioContext and worklet, a read-only tap on the stream. Any failure here is swallowed
 * and reported as `unavailable` — it never touches the recording. Nothing is logged.
 */

export function micMonitorSupported(): boolean {
  return typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined'
}

export class MicMonitor {
  private readonly context: AudioContext
  private readonly nodes: AudioNode[]
  private stopped = false

  private constructor(context: AudioContext, nodes: AudioNode[]) {
    this.context = context
    this.nodes = nodes
  }

  static async start(
    stream: MediaStream,
    {
      calibrate = true,
      onVoice,
      onLevel,
    }: { calibrate?: boolean; onVoice: (active: boolean) => void; onLevel?: (rms: number) => void },
  ): Promise<MicMonitor> {
    const context = new AudioContext()
    try {
      await context.audioWorklet.addModule('/mic-level.js')
      const source = context.createMediaStreamSource(stream)
      const level = new AudioWorkletNode(context, 'mic-level')
      const silent = context.createGain()
      silent.gain.value = 0 // keeps the worklet running without playing the microphone back
      source.connect(level).connect(silent).connect(context.destination)
      const detector = new VoiceDetector({ calibrate })
      level.port.onmessage = (event: MessageEvent<number>) => {
        const change = detector.push(event.data, performance.now())
        if (change !== null) onVoice(change)
        onLevel?.(event.data)
      }
      return new MicMonitor(context, [source, level, silent])
    } catch (error) {
      void context.close().catch(() => {})
      throw error
    }
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.nodes.forEach((node) => node.disconnect())
    void this.context.close().catch(() => {})
  }
}

/* Voice state of the running recording, outside React like the active recorder. */

export interface VoiceState {
  /** `unavailable`: browser can't measure; mic health then shows nothing rather than guessing. */
  status: 'off' | 'on' | 'unavailable'
  active: boolean
  /** When voice was last heard, or when monitoring started (for the silence warning). */
  lastVoiceAt: number
}

const OFF_STATE: VoiceState = { status: 'off', active: false, lastVoiceAt: 0 }
let state: VoiceState = OFF_STATE
let monitor: MicMonitor | null = null
let generation = 0
const listeners = new Set<() => void>()
const levelListeners = new Set<(rms: number) => void>()

function setState(next: VoiceState): void {
  state = next
  listeners.forEach((listener) => listener())
}

/** Called by the recorder when a recording starts. Never throws. */
export async function startVoiceMonitor(stream: MediaStream): Promise<void> {
  stopVoiceMonitor()
  const run = ++generation
  setState({ status: 'on', active: false, lastVoiceAt: Date.now() })
  if (!micMonitorSupported()) return setState({ ...state, status: 'unavailable' })
  try {
    const started = await MicMonitor.start(stream, {
      onVoice: (active) => setState({ ...state, active, lastVoiceAt: Date.now() }),
      onLevel: (rms) => levelListeners.forEach((listener) => listener(rms)),
    })
    if (run === generation) monitor = started
    else started.stop()
  } catch {
    if (run === generation) setState({ ...state, status: 'unavailable' })
  }
}

export function stopVoiceMonitor(): void {
  generation++
  monitor?.stop()
  monitor = null
  setState(OFF_STATE)
}

export function getVoiceState(): VoiceState {
  return state
}

export function useVoiceState(): VoiceState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

/** Loudness for the level meter, ~20 times a second. Not React state: update the DOM directly. */
export function onMicLevel(listener: (rms: number) => void): () => void {
  levelListeners.add(listener)
  return () => levelListeners.delete(listener)
}

/** Test hook: set the voice state directly. */
export function setVoiceStateForTest(next: Partial<VoiceState>): void {
  setState({ ...state, ...next })
}
