import { useTranslation } from 'react-i18next'
import { useMe } from '../../api/auth'

export type SpeakerRole = 'therapist' | 'client' | null

/** Role of a transcript speaker label; null until the user has picked their voice. */
export function roleOfSpeaker(label: string | null, therapist: string | null): SpeakerRole {
  if (therapist === null) return null
  return label === therapist ? 'therapist' : 'client'
}

/** Names instead of roles; the role words stay as fallback while a name is loading. */
export function useSpeakerName(therapist: string | null, clientName: string): (label: string | null) => string {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const userName = me?.display_name || t('transcript.therapist')
  const clientLabel = clientName || t('transcript.client')
  return (label) => {
    const role = roleOfSpeaker(label, therapist)
    if (role === null) return t('transcript.speaker', { label: label ?? '?' })
    return role === 'therapist' ? userName : clientLabel
  }
}
