import { useSyncExternalStore } from 'react'
import { forgetKey, type UnlockedKey } from './pgp'

/** The unlocked therapist key, in memory only (plan 0014). Never stored, never sent. Locks after
 *  15 minutes without activity and when the page is hidden for good (tab closed, reload).
 *  Unlocking is done by the caller (passphrase today; a WebAuthn PRF secret can be added later
 *  without changing this module). */

export const IDLE_LOCK_MS = 15 * 60_000

let unlocked: UnlockedKey | null = null
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const ACTIVITY = ['pointerdown', 'keydown'] as const

function notify(): void {
  listeners.forEach((listener) => listener())
}

function restartIdleTimer(): void {
  clearTimeout(timer)
  timer = setTimeout(lock, IDLE_LOCK_MS)
}

export function setUnlocked(key: UnlockedKey): void {
  if (unlocked && unlocked !== key) forgetKey(unlocked)
  unlocked = key
  restartIdleTimer()
  ACTIVITY.forEach((type) => window.addEventListener(type, restartIdleTimer, { passive: true }))
  window.addEventListener('pagehide', lock)
  notify()
}

export function lock(): void {
  clearTimeout(timer)
  ACTIVITY.forEach((type) => window.removeEventListener(type, restartIdleTimer))
  window.removeEventListener('pagehide', lock)
  if (!unlocked) return
  forgetKey(unlocked)
  unlocked = null
  notify()
}

/** The unlocked key, or null when locked. Using the key counts as activity. */
export function unlockedKey(): UnlockedKey | null {
  if (unlocked) restartIdleTimer()
  return unlocked
}

export function useUnlocked(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => unlocked !== null,
  )
}
