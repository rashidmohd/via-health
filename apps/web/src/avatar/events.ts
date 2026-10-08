import type { AvatarEvent } from './mood'

/** App events for the avatar. Payload-free by design: nothing from a session can be passed. */
let last: { event: AvatarEvent; at: number } | null = null
const listeners = new Set<() => void>()

export function emitAvatarEvent(event: AvatarEvent): void {
  last = { event, at: Date.now() }
  listeners.forEach((listener) => listener())
}

export function lastAvatarEvent(): { event: AvatarEvent; at: number } | null {
  return last
}

export function onAvatarEvent(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
