/**
 * Drawn avatar appearance (ADR 0013): parts + colours that drive the rigged Rive character and,
 * until it is delivered, the SVG stand-in. Suggested from a photo, always reviewed by the user.
 * The three ready-made characters (ADR 0012) are presets of the same description.
 */

export const HAIR_STYLES = [
  'shaved',
  'short',
  'medium',
  'long',
  'curly_short',
  'curly_long',
  'tied_back',
  'bun',
  'headscarf',
] as const
export const GLASSES = ['none', 'round', 'rectangular'] as const
export const BEARDS = ['none', 'stubble', 'short', 'full'] as const

export type HairStyle = (typeof HAIR_STYLES)[number]
export type Glasses = (typeof GLASSES)[number]
export type Beard = (typeof BEARDS)[number]

export interface Appearance {
  hair_style: HairStyle
  hair_color: string
  skin_color: string
  eye_color: string
  glasses: Glasses
  beard: Beard
}

export const CHARACTERS = [0, 1, 2] as const
export type Character = (typeof CHARACTERS)[number]

export const PRESETS: Record<Character, Appearance> = {
  0: {
    hair_style: 'short',
    hair_color: '#4a3626',
    skin_color: '#e9c39f',
    eye_color: '#4a3626',
    glasses: 'none',
    beard: 'none',
  },
  1: {
    hair_style: 'long',
    hair_color: '#1f1a17',
    skin_color: '#8d5a3b',
    eye_color: '#2b2a26',
    glasses: 'none',
    beard: 'none',
  },
  2: {
    hair_style: 'bun',
    hair_color: '#a0522d',
    skin_color: '#f2d3b8',
    eye_color: '#3a6b5a',
    glasses: 'round',
    beard: 'none',
  },
}

/** `#rrggbb` → [r, g, b] for Rive's colour properties. */
export function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}
