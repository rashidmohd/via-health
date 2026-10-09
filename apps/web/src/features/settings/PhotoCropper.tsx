import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { drawCrop, drawRect, encodePhoto, MAX_ZOOM, OUTPUT_PX, type Crop } from './photoCrop'

const VIEW = 240
const STEP = 8
const ARROWS: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-STEP, 0],
  ArrowRight: [STEP, 0],
  ArrowUp: [0, -STEP],
  ArrowDown: [0, STEP],
}

/** Circle crop with drag and zoom (plan 0012). Preview on a canvas: the CSP allows no blob: images. */
export function PhotoCropper({
  file,
  busy,
  onSave,
  onCancel,
}: {
  file: File
  busy: boolean
  onSave: (photo: Blob) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const preview = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [failed, setFailed] = useState(false)
  const [crop, setCrop] = useState<Crop>({ zoom: 1, x: 0, y: 0 })

  useEffect(() => {
    let cancelled = false
    let bitmap: ImageBitmap | null = null
    // Applies the photo's orientation, then the pixels are all that is kept.
    createImageBitmap(file)
      .then((loaded) => {
        bitmap = loaded
        if (cancelled) loaded.close()
        else setImage(loaded)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      bitmap?.close()
    }
  }, [file])

  useEffect(() => {
    if (image && preview.current) drawCrop(preview.current, image, VIEW, crop)
  }, [image, crop])

  // Keep the stored offset inside the limits, so dragging back feels immediate.
  function update(next: Crop) {
    if (!image) return
    const rect = drawRect(image, VIEW, next)
    setCrop({ ...next, x: rect.offsetX, y: rect.offsetY })
  }

  async function save() {
    if (!image) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_PX
    canvas.height = OUTPUT_PX
    try {
      drawCrop(canvas, image, VIEW, crop)
      onSave(await encodePhoto(canvas))
    } catch {
      setFailed(true)
    }
  }

  if (failed) {
    return (
      <div className="banner warning" role="alert">
        <p>{t('settings.avatar.prepareFailed')}</p>
        <button className="secondary" onClick={onCancel}>
          {t('settings.avatar.crop.cancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="photo-cropper stack">
      <h3>{t('settings.avatar.crop.title')}</h3>
      <p className="muted small">{t('settings.avatar.crop.hint')}</p>
      <canvas
        ref={preview}
        className="crop-view"
        width={VIEW}
        height={VIEW}
        tabIndex={0}
        aria-label={t('settings.avatar.crop.title')}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, y: event.clientY, crop }
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (start) {
            update({ ...start.crop, x: start.crop.x + event.clientX - start.x, y: start.crop.y + event.clientY - start.y })
          }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(event) => {
          const move = ARROWS[event.key]
          if (!move) return
          event.preventDefault()
          update({ ...crop, x: crop.x + move[0], y: crop.y + move[1] })
        }}
      />
      <label className="crop-zoom small">
        {t('settings.avatar.crop.zoom')}
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.05}
          value={crop.zoom}
          onChange={(event) => update({ ...crop, zoom: Number(event.target.value) })}
        />
      </label>
      <div className="actions">
        <button className="primary" onClick={() => void save()} disabled={!image || busy}>
          {t('settings.avatar.crop.save')}
        </button>
        <button className="secondary" onClick={onCancel} disabled={busy}>
          {t('settings.avatar.crop.cancel')}
        </button>
      </div>
    </div>
  )
}
