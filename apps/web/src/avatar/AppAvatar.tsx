import { useMe } from '../api/auth'
import { Initials } from '../design/Initials'
import { AvatarRing } from './AvatarRing'
import type { Mood } from './mood'
import { RiveAvatar } from './RiveAvatar'
import { ringState, type RingBadge } from './ring'
import { useAvatarSettings } from './settings'
import { useAvatarMood } from './useAvatarMood'

/** The user's chosen avatar (Settings): the illustrated character or their initials. */
export function UserAvatar({
  mood,
  nod = false,
  recording = false,
  size,
}: {
  mood: Mood
  nod?: boolean
  recording?: boolean
  size: number
}) {
  const { kind } = useAvatarSettings()
  const { data: me } = useMe()
  if (kind === 'initials') return <Initials name={me?.display_name ?? ''} size={size} />
  return <RiveAvatar mood={mood} nod={nod} recording={recording} size={size} />
}

/**
 * The user's avatar with its ring, for screens outside the recording. App state only:
 * `processing` / `problem` / `done` come from the screen. Voice activity is shown only on the
 * recording screen. Status is always also shown as text by the screen.
 */
export function AppAvatar({
  size,
  processing = false,
  problem = false,
  done = false,
}: {
  size: number
  processing?: boolean
  problem?: boolean
  done?: boolean
}) {
  const { mood, nod, recording, online } = useAvatarMood({ processing, problem })
  const badge: RingBadge | null = !online ? 'offline' : done ? 'done' : null
  return (
    <AvatarRing state={ringState({ recording: false, voiceActive: false, processing })} badge={badge}>
      <UserAvatar mood={mood} nod={nod} recording={recording} size={size} />
    </AvatarRing>
  )
}
