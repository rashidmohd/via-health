import { Check, CloudOff } from 'lucide-react'
import type { ReactNode } from 'react'
import type { RingBadge, RingState } from './ring'

/**
 * Ring around any avatar (illustrated, photo, initials). Shows recording voice activity and
 * processing — never the face. Binary voice state only: the animation never scales with
 * loudness and does not tell speakers apart. Decorative: the state is always also shown as text.
 */
export function AvatarRing({
  state,
  badge,
  children,
}: {
  state: RingState
  badge?: RingBadge | null
  children: ReactNode
}) {
  return (
    <div className={`avatar-ring is-${state}`} data-ring={state}>
      {children}
      {badge && (
        <span className={`ring-badge ${badge}`} aria-hidden="true" data-badge={badge}>
          {badge === 'done' ? <Check className="icon" /> : <CloudOff className="icon" />}
        </span>
      )}
    </div>
  )
}
