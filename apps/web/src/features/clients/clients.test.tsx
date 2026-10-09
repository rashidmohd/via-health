import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ClientDetail } from '../../api/clients'
import i18n from '../../i18n'
import { confirmInDialog, ME, mockApi, renderApp } from '../../test-utils'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

function clientDetail(overrides: Partial<ClientDetail> = {}): ClientDetail {
  return {
    id: 'c1',
    name: 'Anna Weber',
    preferred_language: 'de',
    status: 'active',
    consent: { recording: 'missing', ai_processing: 'missing', product_improvement: 'missing' },
    ready_to_record: false,
    last_session_at: null,
    created_at: '2026-10-08T10:00:00Z',
    identity: { name: 'Anna Weber', date_of_birth: null, email: null, phone: null },
    consents: [],
    ...overrides,
  }
}

const TEXTS = (language: string) =>
  ['recording', 'ai_processing', 'product_improvement'].map((kind, i) => ({
    id: `t${i}-${language}`,
    kind,
    version: 0,
    language,
    body: `${language === 'de' ? 'PROTOTYP' : 'PROTOTYPE'} text for ${kind}`,
  }))

function stubCanvas() {
  const context = {
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG)
}

describe('clients', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists clients with their recording readiness', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      return {
        status: 200,
        body: [
          clientDetail({ ready_to_record: true, consent: { recording: 'granted', ai_processing: 'granted', product_improvement: 'missing' } }),
          clientDetail({ id: 'c2', name: 'Ben Braun' }),
        ],
      }
    })
    renderApp('/clients')
    const anna = (await screen.findByText('Anna Weber')).closest('tr')!
    expect(within(anna).getByText('Ready to record')).toBeInTheDocument()
    const ben = screen.getByText('Ben Braun').closest('tr')!
    expect(within(ben).getByText('Consent missing')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search clients'), { target: { value: 'ben' } })
    expect(screen.queryByText('Anna Weber')).not.toBeInTheDocument()
  })

  it('filters by readiness and offers the next step per row', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      return {
        status: 200,
        body: [
          clientDetail({ ready_to_record: true, consent: { recording: 'granted', ai_processing: 'granted', product_improvement: 'missing' } }),
          clientDetail({ id: 'c2', name: 'Ben Braun' }),
          clientDetail({ id: 'c3', name: 'Cem Arslan', status: 'archived' }),
        ],
      }
    })
    renderApp('/clients')
    await screen.findByText('Anna Weber')
    expect(screen.getByText('3 clients')).toBeInTheDocument()

    // Ready → record; consent missing → consent form; archived → no action.
    expect(screen.getByRole('link', { name: 'Record a session with Anna Weber' })).toHaveAttribute('href', '/sessions/record/c1')
    expect(screen.getByRole('link', { name: 'Add consent for Ben Braun' })).toHaveAttribute('href', '/clients/c2/consent')
    const cem = screen.getByText('Cem Arslan').closest('tr')!
    expect(within(cem).getAllByRole('link')).toHaveLength(1)

    const filters = screen.getByRole('group', { name: 'Show' })
    fireEvent.click(within(filters).getByRole('button', { name: /Needs consent/ }))
    expect(screen.getByText('Ben Braun')).toBeInTheDocument()
    expect(screen.queryByText('Anna Weber')).not.toBeInTheDocument()
    expect(screen.queryByText('Cem Arslan')).not.toBeInTheDocument()

    fireEvent.click(within(filters).getByRole('button', { name: /Ready to record/ }))
    expect(screen.getByText('Anna Weber')).toBeInTheDocument()
    expect(screen.queryByText('Ben Braun')).not.toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    mockApi((url) => (url.endsWith('/auth/me') ? { status: 200, body: ME } : { status: 200, body: [] }))
    renderApp('/clients')
    expect(await screen.findByText('No clients yet.')).toBeInTheDocument()
  })

  it('adds a client and goes on to consent', async () => {
    const calls = mockApi((url, init) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/clients') && init.method === 'POST') return { status: 201, body: clientDetail() }
      if (url.includes('/consent-texts')) return { status: 200, body: TEXTS('de') }
      return { status: 200, body: clientDetail() }
    })
    renderApp('/clients/new')
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: ' Anna Weber ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { name: 'Consent' })).toBeInTheDocument()
    const post = calls.find((c) => c.method === 'POST')
    expect(post?.body).toMatchObject({ name: 'Anna Weber', preferred_language: 'de', email: null })
  })

  it('takes the date of birth typed or picked, in the app\'s own date field', async () => {
    const calls = mockApi((url, init) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/clients') && init.method === 'POST') return { status: 201, body: clientDetail() }
      if (url.includes('/consent-texts')) return { status: 200, body: TEXTS('de') }
      return { status: 200, body: clientDetail() }
    })
    renderApp('/clients/new')
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Anna Weber' } })
    const dob = screen.getByLabelText(/Date of birth/)
    const save = screen.getByRole('button', { name: 'Save' })

    // Not a real date: error after leaving the field, saving blocked.
    fireEvent.change(dob, { target: { value: '31/02/1990' } })
    fireEvent.blur(dob)
    expect(dob).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a valid date, e.g. 31/12/1990.')).toBeInTheDocument()
    expect(save).toBeDisabled()

    // Short forms are completed on leaving the field.
    fireEvent.change(dob, { target: { value: '1.2.90' } })
    fireEvent.blur(dob)
    expect(dob).toHaveValue('01/02/1990')
    expect(dob).not.toHaveAttribute('aria-invalid')

    // The calendar opens on the chosen month; picking a day fills the field.
    fireEvent.click(screen.getByRole('button', { name: 'Choose date' }))
    const calendar = screen.getByRole('dialog', { name: 'Choose date' })
    expect(within(calendar).getByRole('combobox', { name: 'Month' })).toHaveValue('2')
    expect(within(calendar).getByRole('combobox', { name: 'Year' })).toHaveValue('1990')
    fireEvent.change(within(calendar).getByRole('combobox', { name: 'Year' }), { target: { value: '1985' } })
    fireEvent.click(within(calendar).getByRole('button', { name: /14 February 1985/ }))
    expect(screen.queryByRole('dialog', { name: 'Choose date' })).not.toBeInTheDocument()
    expect(dob).toHaveValue('14/02/1985')

    fireEvent.click(save)
    expect(await screen.findByRole('heading', { name: 'Consent' })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ date_of_birth: '1985-02-14' })
  })

  it('records consent: nothing pre-ticked, each kind separate, signature required', async () => {
    stubCanvas()
    let granted = false
    const calls = mockApi((url, init) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.includes('/consent-texts?language=de')) return { status: 200, body: TEXTS('de') }
      if (url.includes('/consent-texts?language=en')) return { status: 200, body: TEXTS('en') }
      if (url.endsWith('/consents') && init.method === 'POST') {
        granted = true
        return { status: 201, body: clientDetail({ ready_to_record: true }) }
      }
      return { status: 200, body: clientDetail({ ready_to_record: granted }) }
    })
    renderApp('/clients/c1/consent')

    // Texts in the client's language (de), switchable.
    expect(await screen.findByText('PROTOTYP text for recording')).toBeInTheDocument()
    const textLanguage = screen.getByRole('group', { name: 'Language of the texts' })
    fireEvent.click(within(textLanguage).getByRole('button', { name: 'EN' }))
    expect(await screen.findByText('PROTOTYPE text for recording')).toBeInTheDocument()

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(3)
    boxes.forEach((box) => expect(box).not.toBeChecked())

    const save = screen.getByRole('button', { name: 'Save consent' })
    fireEvent.click(screen.getByLabelText('I agree to the audio recording.'))
    fireEvent.click(screen.getByLabelText('I agree to the AI processing.'))
    expect(save).toBeDisabled() // no signature yet

    const pad = screen.getByRole('img', { name: 'Signature area' })
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(pad, { clientX: 40, clientY: 30 })
    fireEvent.pointerUp(pad)
    expect(save).toBeEnabled()

    fireEvent.click(save)
    await waitFor(() => expect(granted).toBe(true))
    const post = calls.find((c) => c.url.endsWith('/consents'))
    expect(post?.body).toEqual({
      kinds: ['recording', 'ai_processing'],
      language: 'en',
      signed_by: 'client',
      signature: PNG,
    })
  })

  it('withdraws a consent after confirmation', async () => {
    const consent = {
      id: 'k1',
      kind: 'recording' as const,
      text_version: 0,
      language: 'de' as const,
      granted_at: '2026-10-08T10:00:00Z',
      withdrawn_at: null,
      signed_by: 'client' as const,
      method: 'tablet_signature',
    }
    const calls = mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.includes('/sessions')) return { status: 200, body: [] }
      if (url.endsWith('/withdraw')) {
        return {
          status: 200,
          body: clientDetail({
            consents: [{ ...consent, withdrawn_at: '2026-10-09T10:00:00Z' }],
            consent: { recording: 'withdrawn', ai_processing: 'missing', product_improvement: 'missing' },
          }),
        }
      }
      return {
        status: 200,
        body: clientDetail({
          consents: [consent],
          consent: { recording: 'granted', ai_processing: 'missing', product_improvement: 'missing' },
        }),
      }
    })
    renderApp('/clients/c1')
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }))
    await confirmInDialog('Withdraw')
    expect(await screen.findByText(/withdrawn 9 Oct 2026/)).toBeInTheDocument()
    expect(calls.some((c) => c.url.endsWith('/consents/k1/withdraw'))).toBe(true)
    expect(screen.getByText('Consent withdrawn')).toBeInTheDocument()
  })

  it('shows German labels', async () => {
    await i18n.changeLanguage('de')
    mockApi((url) =>
      url.endsWith('/auth/me')
        ? { status: 200, body: ME }
        : url.includes('/sessions')
          ? { status: 200, body: [] }
          : { status: 200, body: clientDetail() },
    )
    renderApp('/clients/c1')
    expect(await screen.findByText('Einwilligung fehlt')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Einwilligung erfassen' })).toBeInTheDocument()
  })
})
