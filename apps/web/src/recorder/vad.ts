/**
 * Voice activity detection (plan 0011): detects THAT someone is speaking — never who, what, or
 * how they sound. RMS energy with hysteresis and a hold so the state does not flicker between
 * words. Thresholds adapt to the room's noise floor measured in the first seconds.
 */

export const ON = 0.02
export const OFF = 0.012
export const HOLD_MS = 600
export const CALIBRATION_MS = 2000
/** Upper bound for calibrated thresholds, so a loud start can't make speech undetectable. */
const MAX_ON = 0.1

export class VoiceDetector {
  private on = ON
  private off = OFF
  private active = false
  private lastVoice = -Infinity
  private startedAt: number | null = null
  /** Levels collected for calibration; null once calibrated (or when calibration is off). */
  private calibration: number[] | null

  constructor({ calibrate = true }: { calibrate?: boolean } = {}) {
    this.calibration = calibrate ? [] : null
  }

  get voiceActive(): boolean {
    return this.active
  }

  /** Feed one RMS measurement. Returns the new state when it changes, otherwise null. */
  push(rms: number, now: number): boolean | null {
    if (this.calibration) {
      this.startedAt ??= now
      if (now - this.startedAt < CALIBRATION_MS) {
        this.calibration.push(rms)
        return null // stay off until the room is measured
      }
      this.calibrate(this.calibration)
      this.calibration = null
    }

    if (rms > this.on) {
      this.lastVoice = now
      if (!this.active) return (this.active = true)
    } else if (this.active && rms < this.off && now - this.lastVoice > HOLD_MS) {
      return (this.active = false)
    }
    return null
  }

  /** Noise floor = 20th percentile (robust if someone already speaks during calibration). */
  private calibrate(levels: number[]): void {
    if (levels.length === 0) return
    const sorted = [...levels].sort((a, b) => a - b)
    const floor = sorted[Math.floor(sorted.length * 0.2)]
    this.on = Math.min(MAX_ON, Math.max(ON, floor * 4))
    this.off = Math.min(this.on * 0.6, Math.max(OFF, floor * 2.5))
  }
}
