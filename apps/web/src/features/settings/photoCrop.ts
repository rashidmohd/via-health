/**
 * Profile photo crop + re-encode (plan 0012). Drawing onto a canvas and encoding a new file drops
 * all metadata of the original (EXIF incl. GPS, XMP); the server rejects files that still carry any.
 */

export const OUTPUT_PX = 512
export const MAX_BYTES = 300_000
export const MAX_ZOOM = 4

export interface Crop {
  zoom: number
  /** Offset of the image centre from the viewport centre, in viewport pixels. */
  x: number
  y: number
}

/** Where the image is drawn in a square viewport of `view` px: covers the circle, never leaves a gap. */
export function drawRect(image: { width: number; height: number }, view: number, crop: Crop) {
  const scale = Math.max(view / image.width, view / image.height) * crop.zoom
  const width = image.width * scale
  const height = image.height * scale
  const x = clamp(crop.x, (width - view) / 2)
  const y = clamp(crop.y, (height - view) / 2)
  return { x: (view - width) / 2 + x, y: (view - height) / 2 + y, width, height, offsetX: x, offsetY: y }
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
}

export function drawCrop(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource & { width: number; height: number },
  view: number,
  crop: Crop,
): void {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  const k = canvas.width / view
  const rect = drawRect(image, view, crop)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, rect.x * k, rect.y * k, rect.width * k, rect.height * k)
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** WebP where the browser can encode it (Safari can't), JPEG otherwise; smaller if needed. */
export async function encodePhoto(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of [0.85, 0.7, 0.5]) {
    let blob = await toBlob(canvas, 'image/webp', quality)
    if (blob?.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', quality)
    if (!blob || (blob.type !== 'image/webp' && blob.type !== 'image/jpeg')) break
    if (blob.size <= MAX_BYTES) return blob
  }
  throw new Error('photo_too_large')
}
