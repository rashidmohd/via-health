import { useMe, type AvatarKind } from '../api/auth'
import { CHARACTERS, type Character } from './rive'

/** The user's profile picture settings, stored on the account (plan 0012). Not health data. */
export type { AvatarKind }

export interface AvatarSettings {
  kind: AvatarKind
  /** Short glance on a new capture chip during a recording. Off by default. */
  nodOnCapture: boolean
  /** ±4° photo tilt toward the pointer. Off by default; never while recording. */
  tilt: boolean
  /** Which ready-made character (ADR 0012). */
  character: Character
  hasPhoto: boolean
}

export function useAvatarSettings(): AvatarSettings {
  const { data: me } = useMe()
  const hasPhoto = me?.has_photo === true
  const kind = me?.avatar_kind ?? 'illustrated'
  return {
    kind: kind === 'photo' && !hasPhoto ? 'illustrated' : kind,
    nodOnCapture: me?.avatar_reactions === true,
    tilt: me?.avatar_tilt === true,
    character: CHARACTERS.find((c) => c === me?.avatar_character) ?? 0,
    hasPhoto,
  }
}
