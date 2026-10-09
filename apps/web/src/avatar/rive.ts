import type { Mood } from './mood'

/**
 * Rive state machine contract (plan 0011, avatar-and-ui skill). Artboard `Avatar`, state machine
 * `Avatar`. Names must match the designer's file exactly.
 */
export const RIVE_SRC = '/avatar/sessio-avatar.riv'
export const PLACEHOLDER_SRC = '/avatar/placeholder.png'
export const ARTBOARD = 'Avatar'
export const STATE_MACHINE = 'Avatar'
export const INPUT = { lookX: 'lookX', lookY: 'lookY', emotion: 'emotion', recording: 'recording', noted: 'noted' } as const

export const EMOTION: Record<Mood, number> = {
  attentive: 0,
  welcome: 1,
  thinking: 2,
  encouraging: 3,
  pleased: 4,
  concern: 5,
  still: 6,
}

/** Let the character settle into `still` before rendering stops (frees CPU while recording). */
export const PAUSE_AFTER_MS = 600

let file: Promise<ArrayBuffer | null> | null = null

/** The character file, fetched once per page load. `null` if it is missing or not a Rive file
 *  (e.g. not delivered yet) — then no Rive code or WASM is loaded at all. */
export function loadRiveFile(): Promise<ArrayBuffer | null> {
  file ??= fetch(RIVE_SRC)
    .then(async (response) => {
      if (!response.ok) return null
      const bytes = await response.arrayBuffer()
      const magic = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)))
      return magic === 'RIVE' ? bytes : null
    })
    .catch(() => null)
  return file
}

/** Test hook. */
export function resetRiveFileForTest(): void {
  file = null
}
