import { useSyncExternalStore } from 'react'

/** In-app replacement for window.confirm. Call `confirmDialog()` anywhere; `ConfirmHost`
 *  (mounted once in the shell) shows it. Resolves true only when the action is confirmed. */

export interface ConfirmOptions {
  message: string
  /** Label of the confirming button, naming the action ("Stop recording", not "OK"). */
  confirmLabel: string
  cancelLabel?: string
  /** `danger` for actions that delete, stop or cannot be undone. */
  tone?: 'danger' | 'primary'
}

interface Pending extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

let pending: Pending | null = null
const listeners = new Set<() => void>()

function setPending(next: Pending | null): void {
  pending = next
  listeners.forEach((listener) => listener())
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  pending?.resolve(false) // only one question at a time; a newer one replaces it
  return new Promise((resolve) => setPending({ ...options, resolve }))
}

export function answer(confirmed: boolean): void {
  const current = pending
  setPending(null)
  current?.resolve(confirmed)
}

export function usePendingConfirm(): ConfirmOptions | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => pending,
  )
}
