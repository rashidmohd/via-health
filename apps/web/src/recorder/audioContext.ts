/**
 * One AudioContext shared by the mic monitor and the live preview while the microphone is open.
 *
 * Safari starts a context created after awaiting getUserMedia `suspended` (the click has
 * expired) and suspends it again (`interrupted`) on calls, Siri or audio-device changes; a
 * suspended context processes nothing, so the microphone looks silent. `keepRunning` resumes it
 * at once (allowed while the page captures audio), on every state change and on the next tap.
 */

const GESTURES = ['pointerdown', 'touchend', 'keydown'] as const

export function keepRunning(context: AudioContext): () => void {
  const resume = () => {
    if (context.state === 'suspended' || (context.state as string) === 'interrupted') {
      void context.resume().catch(() => {})
    }
  }
  resume()
  context.addEventListener('statechange', resume)
  GESTURES.forEach((name) => window.addEventListener(name, resume, { capture: true }))
  return () => {
    context.removeEventListener('statechange', resume)
    GESTURES.forEach((name) => window.removeEventListener(name, resume, { capture: true }))
  }
}

let shared: { context: AudioContext; stopKeeping: () => void; modules: Map<string, Promise<void>> } | null = null
let users = 0

/** The microphone's own rate (Bluetooth headsets switch to 16 kHz when their mic opens). */
function streamSampleRate(stream: MediaStream): number | undefined {
  return stream.getAudioTracks()[0]?.getSettings?.().sampleRate
}

export interface SharedAudio {
  context: AudioContext
  /** Loads a worklet module once per context (Safari rejects registering a processor twice). */
  addModule: (url: string) => Promise<void>
  release: () => void
}

/** The shared context for `stream`; closed when the last user releases it. Create it only after
 *  getUserMedia has resolved: a context made earlier keeps the output rate, and Safari feeds
 *  it silence when the microphone runs at another rate. */
export function acquireAudioContext(stream: MediaStream): SharedAudio {
  if (!shared) {
    const sampleRate = streamSampleRate(stream)
    const context = new AudioContext({ latencyHint: 'interactive', ...(sampleRate ? { sampleRate } : {}) })
    shared = { context, stopKeeping: keepRunning(context), modules: new Map() }
  }
  const current = shared
  users++
  let released = false
  return {
    context: current.context,
    addModule: (url) => {
      let loading = current.modules.get(url)
      if (!loading) {
        loading = current.context.audioWorklet.addModule(url)
        loading.catch(() => current.modules.delete(url))
        current.modules.set(url, loading)
      }
      return loading
    },
    release: () => {
      if (released) return
      released = true
      users--
      if (users > 0 || shared !== current) return
      current.stopKeeping()
      void current.context.close().catch(() => {})
      shared = null
    },
  }
}
