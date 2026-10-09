import { useEffect, useSyncExternalStore } from 'react'
import { playCue } from './cues'
import type { RecorderProblem, SessionRecorder } from './recorder'

/** The recorder running in this tab (at most one). Lives outside React so navigating
 *  between screens never stops a recording. The client and the last problem live here
 *  too, so the recording dock can show them on any screen. */
export interface ActiveRecording {
  recorder: SessionRecorder
  clientId: string
  clientName: string
  problem: RecorderProblem | null
  /** Counts microphone reconnects (ADR 0022): taps on the stream, like the live preview,
   *  restart when it changes. */
  micGeneration: number
  /** When the microphone last came back, for a short note. */
  reconnectedAt: number | null
}

let active: ActiveRecording | null = null
const listeners = new Set<() => void>()

function publish(next: ActiveRecording | null): void {
  active = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setActiveRecorder(
  recorder: SessionRecorder | null,
  client?: { id: string; name: string },
): void {
  publish(
    recorder
      ? {
          recorder,
          clientId: client?.id ?? '',
          clientName: client?.name ?? '',
          problem: null,
          micGeneration: 0,
          reconnectedAt: null,
        }
      : null,
  )
}

/** Recorder problems (mic lost, storage full …) stay visible wherever the user is. */
export function reportRecorderProblem(recorder: SessionRecorder, problem: RecorderProblem): void {
  if (active?.recorder === recorder) publish({ ...active, problem })
}

/** The microphone is back: clear the alert, restart stream taps. */
export function reportMicReconnected(recorder: SessionRecorder): void {
  if (active?.recorder !== recorder) return
  publish({ ...active, problem: null, micGeneration: active.micGeneration + 1, reconnectedAt: Date.now() })
}

/** "Reconnect microphone" button. False: no working microphone found (the alert stays). */
export async function reconnectMicrophone(): Promise<boolean> {
  return (await active?.recorder.reconnect()) ?? false
}

export function getActiveRecorder(): SessionRecorder | null {
  return active?.recorder ?? null
}

export function useActiveRecorder(): SessionRecorder | null {
  return useSyncExternalStore(subscribe, () => active?.recorder ?? null)
}

export function useActiveRecording(): ActiveRecording | null {
  return useSyncExternalStore(subscribe, () => active)
}

/** Stop the running recording (caller has already confirmed). Returns its session id. */
export async function stopActiveRecording(): Promise<string | null> {
  const recorder = active?.recorder
  if (!recorder) return null
  await recorder.stop()
  playCue('stop') // after stop, so the sound is not in the recording
  publish(null)
  return recorder.sessionId
}

/** The browser's own "leave site?" prompt while recording, on every screen. Browsers do not
 *  allow custom content here. */
export function useWarnBeforeUnloadWhileRecording(): void {
  const active = useActiveRecorder()
  useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
}
