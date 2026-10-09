import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Appearance, HairStyle } from './appearance'
import type { Mood } from './mood'

/**
 * SVG stand-in for the Rive character (ADR 0013): draws any appearance with the same moods,
 * eye tracking and nod, until the designer's file exists. Decorative: all state is also text.
 */

const MOUTH: Record<Mood, string> = {
  attentive: 'M 45 63 Q 50 66 55 63',
  welcome: 'M 43.5 62.5 Q 50 68.5 56.5 62.5',
  thinking: 'M 46 64 L 54 63.4',
  encouraging: 'M 43 62 Q 50 69.5 57 62',
  pleased: 'M 42.5 62 Q 50 70 57.5 62',
  concern: 'M 45 65 Q 50 62.8 55 65',
  still: 'M 46 64 Q 50 65 54 64',
}

const BROWS: Record<Mood, [string, string]> = {
  attentive: ['M 35.5 41 Q 40 38.6 44.5 40.6', 'M 55.5 40.6 Q 60 38.6 64.5 41'],
  welcome: ['M 35.5 40 Q 40 37.4 44.5 39.6', 'M 55.5 39.6 Q 60 37.4 64.5 40'],
  thinking: ['M 35.5 41 Q 40 39 44.5 40.8', 'M 55.5 39 Q 60 36.6 64.5 39.4'],
  encouraging: ['M 35.5 39.6 Q 40 37 44.5 39.2', 'M 55.5 39.2 Q 60 37 64.5 39.6'],
  pleased: ['M 35.5 40.4 Q 40 37.8 44.5 40', 'M 55.5 40 Q 60 37.8 64.5 40.4'],
  concern: ['M 35.5 41 Q 40 40.2 44.5 38.6', 'M 55.5 38.6 Q 60 40.2 64.5 41'],
  still: ['M 35.5 41 Q 40 40 44.5 41', 'M 55.5 41 Q 60 40 64.5 41'],
}

const HEAD = 'M 27 48 Q 27 23 50 23 Q 73 23 73 48'

/** Hair drawn behind the head (long styles, bun). */
function backHair(style: HairStyle, color: string): ReactNode {
  switch (style) {
    case 'long':
      return <path d="M 22 50 Q 20 20 50 19 Q 80 20 78 50 L 80 80 Q 50 88 20 80 Z" fill={color} />
    case 'medium':
      return <path d="M 24 50 Q 22 21 50 20 Q 78 21 76 50 L 76 66 Q 50 72 24 66 Z" fill={color} />
    case 'curly_long':
      return (
        <g fill={color}>
          <path d="M 21 52 Q 18 19 50 18 Q 82 19 79 52 L 80 78 Q 50 88 20 78 Z" />
          <circle cx="21" cy="62" r="6" />
          <circle cx="79" cy="62" r="6" />
          <circle cx="22" cy="75" r="6" />
          <circle cx="78" cy="75" r="6" />
        </g>
      )
    case 'bun':
      return <circle cx="50" cy="17" r="10" fill={color} />
    case 'tied_back':
      return <ellipse cx="50" cy="20" rx="9" ry="5" fill={color} />
    default:
      return null
  }
}

/** Hair (or headscarf) drawn over the top of the head. */
function frontHair(style: HairStyle, color: string): ReactNode {
  switch (style) {
    case 'shaved':
      return <path d={`${HEAD} Q 66 30 50 29 Q 34 30 27 48 Z`} fill={color} opacity="0.35" />
    case 'short':
      return <path d="M 26 46 Q 26 22 50 22 Q 74 22 74 46 Q 70 32 56 31 Q 44 36 30 34 Q 27 40 26 46 Z" fill={color} />
    case 'medium':
    case 'long':
      return <path d="M 27 50 Q 28 25 50 24 Q 72 25 73 50 Q 66 34 50 33 Q 34 34 27 50 Z" fill={color} />
    case 'curly_short':
    case 'curly_long':
      return (
        <g fill={color}>
          <circle cx="30" cy="38" r="6" />
          <circle cx="36" cy="29" r="7" />
          <circle cx="45" cy="25" r="7" />
          <circle cx="55" cy="25" r="7" />
          <circle cx="64" cy="29" r="7" />
          <circle cx="70" cy="38" r="6" />
        </g>
      )
    case 'tied_back':
    case 'bun':
      return <path d="M 26 46 Q 25 23 50 23 Q 75 23 74 46 Q 72 33 60 30 Q 50 34 40 30 Q 28 33 26 46 Z" fill={color} />
    case 'headscarf':
      return (
        <path
          d="M 50 16 Q 18 16 20 54 Q 22 78 38 86 L 62 86 Q 78 78 80 54 Q 82 16 50 16 Z M 50 27 Q 30 28 30 50 Q 31 70 50 74 Q 69 70 70 50 Q 70 28 50 27 Z"
          fill={color}
          fillRule="evenodd"
        />
      )
  }
}

function beard(style: Appearance['beard'], color: string): ReactNode {
  switch (style) {
    case 'stubble':
      return <path d="M 30 56 Q 32 76 50 77 Q 68 76 70 56 Q 66 70 50 70 Q 34 70 30 56 Z" fill={color} opacity="0.3" />
    case 'short':
      return <path d="M 29 54 Q 31 79 50 80 Q 69 79 71 54 Q 66 69 58 67 Q 50 64 42 67 Q 34 69 29 54 Z" fill={color} />
    case 'full':
      return <path d="M 27 50 Q 27 86 50 87 Q 73 86 73 50 Q 68 68 58 66 Q 50 63 42 66 Q 32 68 27 50 Z" fill={color} />
    default:
      return null
  }
}

function glasses(style: Appearance['glasses']): ReactNode {
  if (style === 'none') return null
  return (
    <g className="drawn-glasses" fill="none">
      {style === 'round' ? (
        <>
          <circle cx="40.5" cy="48.5" r="6" />
          <circle cx="59.5" cy="48.5" r="6" />
        </>
      ) : (
        <>
          <rect x="33.5" y="44" width="14" height="9.5" rx="2" />
          <rect x="52.5" y="44" width="14" height="9.5" rx="2" />
        </>
      )}
      <path d="M 46.5 48 Q 50 46 53.5 48" />
    </g>
  )
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function DrawnFace({
  appearance,
  mood,
  size,
  nod = false,
  recording = false,
  trackPointer = true,
}: {
  appearance: Appearance
  mood: Mood
  size: number
  nod?: boolean
  recording?: boolean
  trackPointer?: boolean
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [look, setLook] = useState({ x: 0, y: 0 })
  const reduced = prefersReducedMotion()
  const follow = trackPointer && !recording && !reduced

  useEffect(() => {
    if (!follow) return
    let frame = 0
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = ref.current?.getBoundingClientRect()
        if (!box) return
        const dx = event.clientX - (box.left + box.width / 2)
        const dy = event.clientY - (box.top + box.height / 2)
        const distance = Math.hypot(dx, dy) || 1
        const reach = Math.min(1, distance / 400)
        setLook({ x: (dx / distance) * 1.6 * reach, y: (dy / distance) * 1.2 * reach })
      })
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [follow])

  const gaze = follow ? look : mood === 'thinking' ? { x: 1.2, y: -1.4 } : { x: 0, y: 0 }
  const { hair_style: style, hair_color: hair, skin_color: skin, eye_color: eyes } = appearance
  const browColor = style === 'headscarf' || style === 'shaved' ? '#3b2f28' : hair

  return (
    <svg
      ref={ref}
      className={`drawn-face mood-${mood}${nod ? ' nod' : ''}${recording ? ' still' : ''}${reduced ? ' reduced' : ''}`}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      data-mood={mood}
      data-hair={style}
    >
      <rect className="drawn-bg" width="100" height="100" />
      <g className="drawn-head">
        {backHair(style, hair)}
        <rect x="41" y="70" width="18" height="16" fill={skin} />
        <path className="drawn-top" d="M 16 100 Q 20 80 50 80 Q 80 80 84 100 Z" />
        <ellipse cx="50" cy="50" rx="23" ry="26" fill={skin} />
        {beard(appearance.beard, hair)}
        {frontHair(style, hair)}
        <g className="drawn-eyes">
          <ellipse cx="40.5" cy="48.5" rx="3.6" ry="3.2" fill="#fff" />
          <ellipse cx="59.5" cy="48.5" rx="3.6" ry="3.2" fill="#fff" />
          <circle cx={40.5 + gaze.x} cy={48.5 + gaze.y} r="2.2" fill={eyes} />
          <circle cx={59.5 + gaze.x} cy={48.5 + gaze.y} r="2.2" fill={eyes} />
          <circle cx={40.5 + gaze.x} cy={48.5 + gaze.y} r="1" fill="#1f1a17" />
          <circle cx={59.5 + gaze.x} cy={48.5 + gaze.y} r="1" fill="#1f1a17" />
        </g>
        <g fill="none" stroke={browColor} strokeWidth="2" strokeLinecap="round" className="drawn-brows">
          <path d={BROWS[mood][0]} />
          <path d={BROWS[mood][1]} />
        </g>
        <path className="drawn-mouth" d={MOUTH[mood]} />
        {glasses(appearance.glasses)}
        {mood === 'thinking' && (
          <g className="drawn-dots">
            <circle cx="78" cy="26" r="1.8" />
            <circle cx="83" cy="20" r="2.2" />
            <circle cx="89" cy="13" r="2.6" />
          </g>
        )}
      </g>
    </svg>
  )
}
