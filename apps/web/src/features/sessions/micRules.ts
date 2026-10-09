import type { VoiceState } from '../../recorder/micMonitor'

export const SILENCE_WARNING_MS = 2 * 60_000
export const MIC_TEST_MS = 5000

export function silenceTooLong(voice: VoiceState, now: number): boolean {
  return voice.status === 'on' && !voice.active && now - voice.lastVoiceAt >= SILENCE_WARNING_MS
}
