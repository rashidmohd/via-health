import { UserBadge } from '../../avatar/AppAvatar'
import { Initials } from '../../design/Initials'
import type { SpeakerRole } from './speakerNames'

/** Round avatar next to a transcript line. Decorative: the name is always shown next to it. */
export function SpeakerAvatar({
  role,
  label,
  clientName,
  size = 32,
}: {
  role: SpeakerRole
  label: string
  clientName: string
  size?: number
}) {
  if (role === 'therapist') return <UserBadge size={size} />
  if (role === 'client') return <Initials name={clientName} size={size} />
  return (
    <span className="speaker-tag" aria-hidden="true" style={{ width: size, height: size }}>
      {label}
    </span>
  )
}
