import { useSyncExternalStore } from 'react'
import type { SessionRecorder } from './recorder'

/** The recorder running in this tab (at most one). Lives outside React so navigating
 *  between screens never stops a recording. */
let active: SessionRecorder | null = null
const listeners = new Set<() => void>()

export function setActiveRecorder(recorder: SessionRecorder | null): void {
  active = recorder
  listeners.forEach((listener) => listener())
}

export function getActiveRecorder(): SessionRecorder | null {
  return active
}

export function useActiveRecorder(): SessionRecorder | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => active,
  )
}
