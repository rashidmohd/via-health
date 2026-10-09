import { useEffect, useRef } from 'react'

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The user's own photo (plan 0012): static, no face animation. Optional ±4° tilt toward the
 *  pointer — off while recording and with reduced motion. Decorative: `aria-hidden`. */
export function PhotoAvatar({
  src,
  size,
  tilt = false,
  recording = false,
}: {
  src: string
  size: number
  tilt?: boolean
  recording?: boolean
}) {
  const ref = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const image = ref.current
    if (!image || !tilt || recording || prefersReducedMotion()) return
    let frame = 0
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const x = (event.clientX / window.innerWidth - 0.5) * 8
        const y = (event.clientY / window.innerHeight - 0.5) * -8
        image.style.transform = `perspective(600px) rotateY(${x}deg) rotateX(${y}deg)`
      })
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
      image.style.transform = ''
    }
  }, [tilt, recording])

  return (
    <img
      ref={ref}
      className="avatar-image avatar-photo"
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      data-avatar="photo"
    />
  )
}
