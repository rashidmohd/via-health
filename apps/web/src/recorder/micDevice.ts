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

/** How long a freshly opened microphone may deliver nothing before it is opened again. */
export const DEAD_MIC_MS = 1500

/** True as soon as the stream delivers any non-zero sample; false after `timeoutMs` of none.
 *  A real microphone always has some noise. Exact digital silence means no audio flows. */
export async function deliversAudio(stream: MediaStream, timeoutMs = DEAD_MIC_MS): Promise<boolean> {
  if (typeof AudioContext === 'undefined') return true // can't check: assume it works
  const context = new AudioContext()
  try {
    void context.resume().catch(() => {})
    const analyser = context.createAnalyser()
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    const until = performance.now() + timeoutMs
    while (performance.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      analyser.getFloatTimeDomainData(samples)
      if (samples.some((sample) => sample !== 0)) return true
    }
    return false
  } catch {
    return true // can't check: assume it works
  } finally {
    void context.close().catch(() => {})
  }
}

/**
 * Opens the microphone and makes sure audio actually flows. Safari on macOS gets a dead stream
 * (live track, no samples, empty recording) when a Bluetooth headset switches to its call mode
 * just after the microphone opens; opening it a second time, after the switch, works.
 */
export async function openMicrophone(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() })
  if (await deliversAudio(stream)) return stream
  stream.getTracks().forEach((track) => track.stop())
  return navigator.mediaDevices.getUserMedia({ audio: audioConstraints() })
}
