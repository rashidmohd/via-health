import { useMe, type AvatarKind } from '../api/auth'
import { CHARACTERS, PRESETS, type Appearance, type Character } from './appearance'

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
  /** Saved drawn appearance (ADR 0013), or null. */
  drawn: Appearance | null
  /** What the illustrated/drawn avatar shows now. */
  appearance: Appearance
  hasPhoto: boolean
}

export function useAvatarSettings(): AvatarSettings {
  const { data: me } = useMe()
  const hasPhoto = me?.has_photo === true
  const kind = me?.avatar_kind ?? 'illustrated'
  const drawn = me?.avatar_appearance ?? null
  const character = CHARACTERS.find((c) => c === me?.avatar_character) ?? 0
  const shown = (kind === 'photo' && !hasPhoto) || (kind === 'drawn' && !drawn) ? 'illustrated' : kind
  return {
    kind: shown,
    nodOnCapture: me?.avatar_reactions === true,
    tilt: me?.avatar_tilt === true,
    character,
    drawn,
    appearance: shown === 'drawn' && drawn ? drawn : PRESETS[character],
    hasPhoto,
  }
}
