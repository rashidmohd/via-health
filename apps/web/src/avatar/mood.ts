/**
 * Avatar mood state machine (avatar-and-ui skill, plan 0007 part 4).
 *
 * Inputs are app state and a closed list of app events — never transcript text, voice or
 * anything said in a session. No emotion recognition (CLAUDE.md rule 12).
 */

export type Mood = 'welcome' | 'attentive' | 'thinking' | 'encouraging' | 'pleased' | 'concern' | 'still'

/** The only events that can move the avatar. They carry no payload. */
export type AvatarEvent = 'client.created' | 'upload.done' | 'transcript.ready' | 'capture.noted'

export interface AvatarInputs {
  recording: boolean
  online: boolean
  /** Upload or processing problem the user should look at. */
  problem: boolean
  /** Transcript or report is being made. */
  processing: boolean
  /** Time since the avatar appeared (for the greeting). */
  sinceShownMs: number
  /** Most recent app event and how long ago it happened. */
  recent: { event: AvatarEvent; ageMs: number } | null
  /** Short nod on capture.noted; off by default (therapist setting). */
  nodOnCapture?: boolean
}

export interface AvatarState {
  mood: Mood
  nod: boolean
}

export const WELCOME_MS = 2500
export const EVENT_MS = 4000
export const NOD_MS = 1000

const EVENT_MOOD: Partial<Record<AvatarEvent, Mood>> = {
  'client.created': 'encouraging',
  'upload.done': 'pleased',
  'transcript.ready': 'pleased',
}

export function moodFor(input: AvatarInputs): AvatarState {
  const recent = input.recent
  const nod = Boolean(
    input.nodOnCapture && recent?.event === 'capture.noted' && recent.ageMs < NOD_MS,
  )
  if (input.recording) return { mood: 'still', nod }
  if (!input.online || input.problem) return { mood: 'concern', nod: false }
  const eventMood = recent && recent.ageMs < EVENT_MS ? EVENT_MOOD[recent.event] : undefined
  if (eventMood) return { mood: eventMood, nod: false }
  if (input.processing) return { mood: 'thinking', nod: false }
  if (input.sinceShownMs < WELCOME_MS) return { mood: 'welcome', nod: false }
  return { mood: 'attentive', nod: false }
}
