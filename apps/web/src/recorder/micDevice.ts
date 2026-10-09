/**
 * Chosen microphone and first-time mic test, per device (plan 0011). Only a browser device id
 * and a flag — no audio, nothing personal — so localStorage is fine here.
 */

const DEVICE_KEY = 'sessio.micDevice'
const TESTED_KEY = 'sessio.micTested'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the choice applies to this visit only.
  }
}

export function preferredMic(): string | null {
  return read(DEVICE_KEY)
}

/** Applies to the next recording. `null` = browser default. */
export function setPreferredMic(deviceId: string | null): void {
  write(DEVICE_KEY, deviceId)
}

export function micTested(): boolean {
  return read(TESTED_KEY) === 'yes'
}

export function setMicTested(): void {
  write(TESTED_KEY, 'yes')
}

/** Recording constraints (offline-recorder skill). The chosen device is a preference, not
 *  `exact`: if it was unplugged, the browser falls back to another microphone. */
export function audioConstraints(): MediaTrackConstraints {
  const deviceId = preferredMic()
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: true,
    channelCount: 1,
    ...(deviceId ? { deviceId } : {}),
  }
}

export async function listMics(): Promise<{ id: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audioinput' && device.deviceId)
    .map((device, index) => ({ id: device.deviceId, label: device.label || `#${index + 1}` }))
}
