import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

/** Draw-to-sign canvas. Reports a PNG data URL, or null when empty or cleared. */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    context.scale(ratio, ratio)
    context.lineWidth = 2
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = getComputedStyle(canvas).color || '#2b2a26'
  }, [])

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drawing.current = true
    const { x, y } = point(event)
    context.beginPath()
    context.moveTo(x, y)
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext('2d')
    if (!drawing.current || !context) return
    const { x, y } = point(event)
    context.lineTo(x, y)
    context.stroke()
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    setEmpty(false)
    onChange(canvasRef.current?.toDataURL('image/png') ?? null)
  }

  function clear() {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setEmpty(true)
    onChange(null)
  }

  return (
    <div className="signature">
      <canvas
        ref={canvasRef}
        className="signature-pad"
        aria-label={t('consent.signatureArea')}
        role="img"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="signature-footer">
        <span className="muted small">{empty ? t('consent.signHere') : t('consent.signed')}</span>
        <button type="button" className="link" onClick={clear} disabled={empty}>
          {t('consent.clearSignature')}
        </button>
      </div>
    </div>
  )
}
