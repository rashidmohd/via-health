import { drawRect, encodePhoto, MAX_BYTES } from './photoCrop'

describe('photo crop', () => {
  const landscape = { width: 800, height: 400 }

  it('covers the square viewport, centred', () => {
    expect(drawRect(landscape, 200, { zoom: 1, x: 0, y: 0 })).toMatchObject({ x: -100, y: 0, width: 400, height: 200 })
  })

  it('zooms around the centre', () => {
    expect(drawRect(landscape, 200, { zoom: 2, x: 0, y: 0 })).toMatchObject({ x: -300, y: -100, width: 800, height: 400 })
  })

  it('never drags the image off the circle', () => {
    const rect = drawRect(landscape, 200, { zoom: 1, x: 500, y: 50 })
    expect(rect).toMatchObject({ x: 0, y: 0, offsetX: 100, offsetY: 0 })
  })
})

describe('photo encoding', () => {
  function canvas(results: (string | null)[], size = 1000) {
    const queue = [...results]
    return {
      toBlob: (callback: (blob: Blob | null) => void) => {
        const type = queue.shift()
        callback(type ? new Blob([new Uint8Array(size)], { type }) : null)
      },
    } as unknown as HTMLCanvasElement
  }

  it('prefers WebP', async () => {
    expect((await encodePhoto(canvas(['image/webp']))).type).toBe('image/webp')
  })

  it('falls back to JPEG where the browser cannot encode WebP (it returns PNG instead)', async () => {
    expect((await encodePhoto(canvas(['image/png', 'image/jpeg']))).type).toBe('image/jpeg')
  })

  it('gives up rather than upload something too large', async () => {
    await expect(encodePhoto(canvas(Array(6).fill('image/webp'), MAX_BYTES + 1))).rejects.toThrow('photo_too_large')
  })
})
