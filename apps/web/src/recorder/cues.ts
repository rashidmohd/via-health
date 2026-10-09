import { readDeviceSetting } from '../features/settings/deviceSettings'

/**
 * Short sounds when a recording starts (rising) and stops (falling), synthesized with Web Audio:
 * no audio files. Played on the speakers only; a failure here never touches the recording.
 */
export type Cue = 'start' | 'stop'

const NOTES: Record<Cue, number[]> = {
  start: [523.25, 783.99], // C5 → G5
  stop: [783.99, 523.25], // G5 → C5
}
const NOTE_GAP_S = 0.14
const NOTE_LENGTH_S = 0.22
const VOLUME = 0.15

let context: AudioContext | null = null

export function playCue(cue: Cue): void {
  if (!readDeviceSetting('recordSounds') || typeof AudioContext === 'undefined') return
  try {
    // One shared context: once a click has let it run, later cues play without a new gesture.
    context ??= new AudioContext()
    const ctx = context
    void ctx.resume().catch(() => {})
    const now = ctx.currentTime + 0.01
    NOTES[cue].forEach((frequency, index) => {
      const start = now + index * NOTE_GAP_S
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(VOLUME, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + NOTE_LENGTH_S)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + NOTE_LENGTH_S + 0.02)
    })
  } catch {
    // No sound on this device; recording is unaffected.
  }
}
