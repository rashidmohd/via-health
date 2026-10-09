import { useSyncExternalStore } from 'react'

/**
 * Settings that belong to this device, not the account (localStorage). All default to on.
 * Unavailable storage: the default applies and a change lasts for this visit only.
 */
export const DEVICE_SETTINGS = {
  /** In-browser live transcript during recordings (plan 0007 part 2). */
  livePreview: 'sessio.livePreview',
  /** Download the live transcript model when the app opens (ADR 0014). */
  livePreload: 'sessio.livePreload',
  /** Short sound when a recording starts and stops (ADR 0014). */
  recordSounds: 'sessio.recordSounds',
} as const

export type DeviceSetting = keyof typeof DEVICE_SETTINGS

const memory = new Map<DeviceSetting, boolean>()
const listeners = new Set<() => void>()

export function readDeviceSetting(setting: DeviceSetting): boolean {
  if (memory.has(setting)) return memory.get(setting)!
  try {
    return localStorage.getItem(DEVICE_SETTINGS[setting]) !== 'off'
  } catch {
    return true
  }
}

export function writeDeviceSetting(setting: DeviceSetting, on: boolean): void {
  memory.set(setting, on)
  try {
    localStorage.setItem(DEVICE_SETTINGS[setting], on ? 'on' : 'off')
    memory.delete(setting)
  } catch {
    // Storage unavailable: kept in memory for this visit.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDeviceSetting(setting: DeviceSetting): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => readDeviceSetting(setting))
  return [value, (on) => writeDeviceSetting(setting, on)]
}
