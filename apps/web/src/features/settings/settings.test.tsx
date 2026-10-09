import { fireEvent, screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n'
import { ME, mockApi, renderApp } from '../../test-utils'

type Me = typeof ME & {
  avatar_kind: string
  avatar_reactions: boolean
  avatar_tilt: boolean
  avatar_character: number
  avatar_appearance: Record<string, string> | null
  has_photo: boolean
}

let me: Me
const SUGGESTED = {
  hair_style: 'curly_short',
  hair_color: '#3b2a20',
  skin_color: '#c68a5e',
  eye_color: '#4a3a2a',
  glasses: 'round',
  beard: 'none',
}
let calls: ReturnType<typeof mockApi>

function server() {
  calls = mockApi((url, init) => {
    const method = init.method ?? 'GET'
    if (url.endsWith('/auth/me') && method === 'PATCH') {
      const body = JSON.parse(init.body as string) as Partial<Me>
      if (body.avatar_kind === 'photo' && !me.has_photo) return { status: 409, body: { code: 'photo_missing' } }
      me = { ...me, ...body }
      return { status: 200, body: me }
    }
    if (url.endsWith('/auth/me')) return { status: 200, body: me }
    if (url.endsWith('/auth/me/avatar') && method === 'PUT') {
      me = { ...me, has_photo: true, avatar_kind: 'photo' }
      return { status: 200, body: me }
    }
    if (url.endsWith('/auth/me/avatar/describe')) {
      return { status: 200, body: SUGGESTED }
    }
    if (url.endsWith('/auth/me/avatar') && method === 'DELETE') {
      me = { ...me, has_photo: false, avatar_kind: 'illustrated' }
      return { status: 200, body: me }
    }
    if (url.endsWith('/auth/me/avatar')) return me.has_photo ? { status: 200, body: 'photo' } : { status: 404 }
    return { status: 200, body: [] }
  })
}

function stubCanvas() {
  const drawImage = vi.fn()
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })),
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage,
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) =>
    callback(new Blob(['re-encoded'], { type: type === 'image/webp' ? 'image/webp' : 'image/jpeg' })),
  )
  return drawImage
}

describe('settings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    me = {
      ...ME,
      avatar_kind: 'illustrated',
      avatar_reactions: false,
      avatar_tilt: false,
      avatar_character: 0,
      avatar_appearance: null,
      has_photo: false,
    }
    server()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('defaults to the illustrated avatar with reactions off; photo needs an upload first', async () => {
    renderApp('/settings')
    expect(await screen.findByRole('radio', { name: /Illustrated avatar/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /My photo/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Short glance/ })).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /Tilt/ })).toBeNull()
  })

  it('saves the profile picture choice on the account and shows it everywhere', async () => {
    const { unmount } = renderApp('/settings')
    fireEvent.click(await screen.findByRole('radio', { name: /Initials/ }))
    await waitFor(() => expect(me.avatar_kind).toBe('initials'))
    unmount()

    renderApp('/')
    await waitFor(() => expect(document.querySelector('.today .avatar-ring .initials')).toHaveTextContent('A'))
    expect(document.querySelector('.today .avatar-ring img')).toBeNull()
  })

  it('offers three ready-made characters and shows the chosen one everywhere', async () => {
    const { unmount } = renderApp('/settings')
    expect(await screen.findByRole('radio', { name: 'Character 1' })).toBeChecked()
    expect(screen.getAllByRole('radio', { name: /^Character \d$/ })).toHaveLength(3)
    fireEvent.click(screen.getByRole('radio', { name: 'Character 3' }))
    await waitFor(() => expect(me.avatar_character).toBe(2))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ avatar_character: 2 })
    unmount()

    renderApp('/')
    await waitFor(() =>
      expect(document.querySelector('.today .avatar-ring svg')).toHaveAttribute('data-hair', 'bun'),
    )
  })

  it('hides the character choice when another picture is chosen', async () => {
    me.avatar_kind = 'initials'
    renderApp('/settings')
    expect(await screen.findByRole('radio', { name: /Initials/ })).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Character 1' })).toBeNull()
  })

  it('saves the reactions choice on the account', async () => {
    renderApp('/settings')
    fireEvent.click(await screen.findByRole('checkbox', { name: /Short glance/ }))
    await waitFor(() => expect(me.avatar_reactions).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ avatar_reactions: true })
  })

  it('crops, re-encodes and uploads a photo, then offers tilt and removal', async () => {
    const drawImage = stubCanvas()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderApp('/settings')

    const original = new File(['jpeg with GPS EXIF'], 'me.jpg', { type: 'image/jpeg' })
    fireEvent.change(await screen.findByLabelText('Choose photo'), { target: { files: [original] } })
    expect(await screen.findByText('Crop the photo')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Use photo' }))

    await waitFor(() => expect(me.has_photo).toBe(true))
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toMatch(/\/auth\/me\/avatar$/)
    // The upload is the canvas output, never the original file (which may carry EXIF/GPS).
    expect(new TextDecoder().decode(put.body as Uint8Array)).toBe('re-encoded')
    // Last draw: the 512 px export, image covering the whole square.
    const [, x, y, width, height] = drawImage.mock.calls.at(-1)!
    expect([x, y, width, height].map(Math.round)).toEqual([-85, 0, 683, 512])

    expect(await screen.findByRole('radio', { name: /My photo/ })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: /Tilt/ }))
    await waitFor(() => expect(me.avatar_tilt).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    await waitFor(() => expect(me.has_photo).toBe(false))
    expect(await screen.findByRole('radio', { name: /Illustrated avatar/ })).toBeChecked()
  })

  it('creates a drawn avatar from a photo: suggestion, correction, save; the photo is not kept', async () => {
    stubCanvas()
    renderApp('/settings')
    expect(await screen.findByRole('radio', { name: /Drawn from my photo/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Create my drawn avatar' }))

    const original = new File(['jpeg with GPS EXIF'], 'me.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Start from a photo'), { target: { files: [original] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Use photo' }))

    expect(await screen.findByText(/Suggested from your photo/)).toBeInTheDocument()
    const describe = calls.find((c) => c.url.endsWith('/describe'))!
    expect(new TextDecoder().decode(describe.body as Uint8Array)).toBe('re-encoded')
    expect(screen.getByLabelText('Hairstyle')).toHaveValue('curly_short')
    expect(screen.getByLabelText('Glasses')).toHaveValue('round')

    fireEvent.change(screen.getByLabelText('Glasses'), { target: { value: 'none' } })
    fireEvent.change(screen.getByLabelText('Hair'), { target: { value: '#AA3300' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use this avatar' }))

    await waitFor(() => expect(me.avatar_kind).toBe('drawn'))
    expect(me.avatar_appearance).toEqual({ ...SUGGESTED, glasses: 'none', hair_color: '#aa3300' })
    expect(calls.some((c) => c.method === 'PUT')).toBe(false) // no photo upload
    expect(await screen.findByRole('radio', { name: /Drawn from my photo/ })).toBeChecked()
  })

  it('says so when the image cannot be opened', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new Error('not an image'))))
    renderApp('/settings')
    const file = new File(['?'], 'x.heic', { type: 'image/heic' })
    fireEvent.change(await screen.findByLabelText('Choose photo'), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be opened')
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})
