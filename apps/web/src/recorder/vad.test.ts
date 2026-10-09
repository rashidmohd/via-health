import { CALIBRATION_MS, HOLD_MS, VoiceDetector } from './vad'

const FRAME_MS = 50

/** Feeds levels at 50 ms steps from `start`; returns every state change with its time. */
function feed(detector: VoiceDetector, levels: number[], start = 0): { at: number; active: boolean }[] {
  const changes: { at: number; active: boolean }[] = []
  levels.forEach((rms, i) => {
    const at = start + i * FRAME_MS
    const change = detector.push(rms, at)
    if (change !== null) changes.push({ at, active: change })
  })
  return changes
}

const repeat = (rms: number, ms: number) => Array<number>(ms / FRAME_MS).fill(rms)
const QUIET = 0.003
const SPEECH = 0.08

describe('voice activity detection', () => {
  it('turns on with speech and off after silence', () => {
    const detector = new VoiceDetector({ calibrate: false })
    const changes = feed(detector, [...repeat(SPEECH, 1000), ...repeat(QUIET, 2000)])
    expect(changes).toEqual([
      { at: 0, active: true },
      { at: 1000 + HOLD_MS, active: false }, // last voice at 950, first frame later than the hold
    ])
    expect(detector.voiceActive).toBe(false)
  })

  it('does not flicker in pauses shorter than the hold time', () => {
    const detector = new VoiceDetector({ calibrate: false })
    const words = [...repeat(SPEECH, 400), ...repeat(QUIET, HOLD_MS - 100)]
    const changes = feed(detector, [...words, ...words, ...words, ...repeat(SPEECH, 400)])
    expect(changes).toEqual([{ at: 0, active: true }])
  })

  it('ignores levels between the on and off thresholds (hysteresis)', () => {
    const detector = new VoiceDetector({ calibrate: false })
    expect(feed(detector, repeat(0.015, 5000))).toEqual([])
    feed(detector, [SPEECH], 5000)
    expect(feed(detector, repeat(0.015, 5000), 5050)).toEqual([])
    expect(detector.voiceActive).toBe(true)
  })

  it('stays stable on constant background noise once calibrated', () => {
    const detector = new VoiceDetector()
    const noise = 0.03 // above the default threshold: would be "voice" without calibration
    expect(feed(detector, repeat(noise, 60_000))).toEqual([])
  })

  it('still detects speech over that noise', () => {
    const detector = new VoiceDetector()
    feed(detector, repeat(0.03, CALIBRATION_MS))
    expect(feed(detector, repeat(0.2, 500), CALIBRATION_MS)).toEqual([{ at: CALIBRATION_MS, active: true }])
  })

  it('stays off while calibrating', () => {
    const detector = new VoiceDetector()
    expect(feed(detector, repeat(SPEECH, CALIBRATION_MS - FRAME_MS))).toEqual([])
  })

  it('keeps speech detectable if someone talks during calibration', () => {
    const detector = new VoiceDetector()
    feed(detector, repeat(0.5, CALIBRATION_MS)) // loud start: thresholds are capped
    expect(feed(detector, repeat(0.15, 200), CALIBRATION_MS)[0]).toEqual({ at: CALIBRATION_MS, active: true })
  })
})
