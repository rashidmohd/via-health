/**
 * Keeps an AudioContext running. Safari starts a context `suspended` when it is not created
 * directly inside a click — ours come after awaiting getUserMedia — and suspends it again
 * (`interrupted`) on phone calls, Siri or audio-session changes. A suspended context processes
 * nothing, so the microphone looks silent. Resumes now, on every state change, and on the next
 * tap or key press. Returns a function that removes the listeners.
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
