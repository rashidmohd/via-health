import { useEffect, useRef, useState } from 'react'
import type { Mood } from './mood'

/** Illustrated placeholder avatar (SVG). Image-frame avatars can replace this component later
 *  with the same props. Decorative only: all state is also shown as text elsewhere. */

const MOUTH: Record<Mood, string> = {
  welcome: 'M 38 64 Q 50 74 62 64',
  attentive: 'M 40 65 Q 50 69 60 65',
  thinking: 'M 42 66 L 58 65',
  encouraging: 'M 38 63 Q 50 75 62 63',
  pleased: 'M 37 62 Q 50 77 63 62',
  concern: 'M 40 68 Q 50 64 60 68',
  still: 'M 42 66 Q 50 68 58 66',
}

/** Eyebrows: [left, right] paths. */
const BROWS: Record<Mood, [string, string]> = {
  welcome: ['M 31 35 Q 37 31 43 34', 'M 57 34 Q 63 31 69 35'],
  attentive: ['M 31 36 Q 37 33 43 36', 'M 57 36 Q 63 33 69 36'],
  thinking: ['M 31 34 Q 37 31 43 35', 'M 57 33 Q 63 30 69 33'],
  encouraging: ['M 31 34 Q 37 30 43 33', 'M 57 33 Q 63 30 69 34'],
  pleased: ['M 31 35 Q 37 32 43 35', 'M 57 35 Q 63 32 69 35'],
  concern: ['M 31 34 Q 37 36 43 38', 'M 57 38 Q 63 36 69 34'],
  still: ['M 31 37 Q 37 35 43 37', 'M 57 37 Q 63 35 69 37'],
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function Avatar({
  mood,
  size = 160,
  trackPointer = false,
  nod = false,
}: {
  mood: Mood
  size?: number
  trackPointer?: boolean
  nod?: boolean
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [look, setLook] = useState({ x: 0, y: 0 })
  const reduced = prefersReducedMotion()
  const follow = trackPointer && !reduced && (mood === 'attentive' || mood === 'welcome')

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
        setLook({ x: (dx / distance) * 2.5 * reach, y: (dy / distance) * 2 * reach })
      })
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [follow])

  const gaze = follow ? look : mood === 'thinking' ? { x: 1.5, y: -2.5 } : { x: 0, y: 0 }
  const eyesClosed = mood === 'still'

  return (
    <svg
      ref={ref}
      className={`avatar mood-${mood}${nod ? ' nod' : ''}${reduced ? ' reduced' : ''}`}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      data-mood={mood}
    >
      <circle className="avatar-ring" cx="50" cy="50" r="48" />
      <g className="avatar-face">
        <circle className="avatar-head" cx="50" cy="50" r="40" />
        <path className="avatar-brow" d={BROWS[mood][0]} />
        <path className="avatar-brow" d={BROWS[mood][1]} />
        {eyesClosed ? (
          <>
            <path className="avatar-lid" d="M 32 46 Q 37 49 42 46" />
            <path className="avatar-lid" d="M 58 46 Q 63 49 68 46" />
          </>
        ) : (
          <g className="avatar-eyes">
            <ellipse className="avatar-eye" cx="37" cy="46" rx="5" ry="5.5" />
            <ellipse className="avatar-eye" cx="63" cy="46" rx="5" ry="5.5" />
            <circle className="avatar-pupil" cx={37 + gaze.x} cy={46.5 + gaze.y} r="2.6" />
            <circle className="avatar-pupil" cx={63 + gaze.x} cy={46.5 + gaze.y} r="2.6" />
          </g>
        )}
        <path className="avatar-mouth" d={MOUTH[mood]} />
        {mood === 'thinking' && (
          <g className="avatar-dots">
            <circle cx="76" cy="24" r="2" />
            <circle cx="82" cy="18" r="2.5" />
            <circle cx="89" cy="11" r="3" />
          </g>
        )}
      </g>
    </svg>
  )
}
