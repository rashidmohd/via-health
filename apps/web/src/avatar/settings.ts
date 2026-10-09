import { useSyncExternalStore } from 'react'

/**
 * The user's avatar settings (plan 0011). Per device for now; moves to the user's account with
 * the profile photo (plan 0012). Not health data.
 */
export type AvatarKind = 'illustrated' | 'initials'

export interface AvatarSettings {
  kind: AvatarKind
  /** Short glance on a new capture chip during a recording. Off by default. */
  nodOnCapture: boolean
}

const KEY = 'sessio.avatar'
const DEFAULTS: AvatarSettings = { kind: 'illustrated', nodOnCapture: false }
const listeners = new Set<() => void>()

function read(): AvatarSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AvatarSettings>
    return {
      kind: stored.kind === 'initials' ? 'initials' : 'illustrated',
      nodOnCapture: stored.nodOnCapture === true,
    }
  } catch {
    return DEFAULTS
  }
}

let current = read()

export function getAvatarSettings(): AvatarSettings {
  return current
}

export function setAvatarSettings(change: Partial<AvatarSettings>): void {
  current = { ...current, ...change }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Storage unavailable: the choice applies to this visit only.
  }
  listeners.forEach((listener) => listener())
}

export function useAvatarSettings(): AvatarSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}

/** Test hook: reload from storage. */
export function reloadAvatarSettingsForTest(): void {
  current = read()
  listeners.forEach((listener) => listener())
}
