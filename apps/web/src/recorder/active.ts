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
  publish(recorder ? { recorder, clientId: client?.id ?? '', clientName: client?.name ?? '', problem: null } : null)
}

/** Recorder problems (mic lost, storage full …) stay visible wherever the user is. */
export function reportRecorderProblem(recorder: SessionRecorder, problem: RecorderProblem): void {
  if (active?.recorder === recorder) publish({ ...active, problem })
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
