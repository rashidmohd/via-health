import { useSyncExternalStore } from 'react'

/**
 * First-run welcome and the app tour (ADR 0020). "Welcome seen" is a per-browser flag keyed by
 * user id — no personal data. Can move to the account later.
 */
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const welcomeKey = (userId: string) => `sessio.welcomeSeen.${userId}`

function readWelcomeSeen(userId: string | undefined): boolean {
  if (!userId) return true
  try {
    return localStorage.getItem(welcomeKey(userId)) === '1'
  } catch {
    return true // storage blocked: never trap the user on the welcome page
  }
}

export function markWelcomeSeen(userId: string): void {
  try {
    localStorage.setItem(welcomeKey(userId), '1')
  } catch {
    // ignore: the welcome may show again in this browser
  }
  emit()
}

export function useWelcomeSeen(userId: string | undefined): boolean {
  return useSyncExternalStore(subscribe, () => readWelcomeSeen(userId))
}

let tourOpen = false

export function startTour(): void {
  tourOpen = true
  emit()
}

export function endTour(): void {
  tourOpen = false
  emit()
}

export function useTourOpen(): boolean {
  return useSyncExternalStore(subscribe, () => tourOpen)
}
