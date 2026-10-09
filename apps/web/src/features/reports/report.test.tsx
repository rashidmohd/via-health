import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { lock } from '../../crypto/keyring'
import i18n from '../../i18n'
import { confirmInDialog, ME, mockApi, renderApp, TEST_KEYS } from '../../test-utils'

// The page flow only; real signing and decryption are covered in crypto/records.test.ts.
const PASSPHRASE = 'olive tree quiet harbour'
vi.mock('../../crypto/pgp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../crypto/pgp')>()),
  unlockPrivateKey: vi.fn(async (_key: string, passphrase: string) => {
    const { PgpError } = await import('../../crypto/pgp')
    if (passphrase !== PASSPHRASE) throw new PgpError('passphrase_wrong')
    return { clearPrivateParams: vi.fn() }
  }),
}))
const OPENED: Record<string, unknown> = {}
vi.mock('../../crypto/records', () => ({
  signNote: vi.fn(async (prepared: { approved_at: string; report_updated_at: string }) => ({
    note: 'signed-note', transcript: 'signed-transcript', index: 'signed-index', addenda: [],
    approved_at: prepared.approved_at, report_updated_at: prepared.report_updated_at,
    signer_fingerprint: 'a'.repeat(64), encrypted_to: ['a'.repeat(64), 'b'.repeat(64)],
  })),
  signAddendum: vi.fn(async (text: string) => ({
    message: `signed:${text}`, signer_fingerprint: 'a'.repeat(64), encrypted_to: ['a'.repeat(64), 'b'.repeat(64)],
  })),
  openRecord: vi.fn(async (message: string) => {
    if (!(message in OPENED)) throw new Error('unknown message')
    return OPENED[message]
  }),
}))

async function unlockWithPassphrase() {
  fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: PASSPHRASE } })
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
}

const SESSION = {
  id: 's1', client_id: 'c1', client_name: 'Anna Weber', started_at: '2026-10-08T10:00:00Z',
  ended_at: null, status: 'transcribed', audio_state: 'present', duration_ms: 3_000_000,
  total_chunks: 300, uploaded_chunks: 300, failure_reason: null, transcribed_ms: 0,
}

const TRANSCRIPT = {
  session_id: 's1', language: 'de-DE', stt_model: 'chirp_3', therapist_speaker: '0',
  refine_status: 'done', corrections: 0,
  segments: [
    { speaker: '0', start_ms: 0, end_ms: 4000, text: 'Wie lief das Protokoll?' },
    { speaker: '1', start_ms: 4100, end_ms: 9000, text: 'Ich habe es an vier Tagen geführt.' },
  ],
}

function statement(id: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    id, text, kind: 'reported', origin: 'ai', refs: [[4100, 9000]], notes: [], support: 'supported',
    ai_wording: [], wording: [], third_party_name: false, resolved: false, blocking: false, ...extra,
  }
}

function report(status: string, extra: Record<string, unknown> = {}) {
  const empty = { status: 'not_discussed', statements: [] }
  return {
    session_id: 's1', status, failure_reason: null, pending_field: null, template_code: 'verlauf',
    template_version: 1, ai_assisted: true, llm_model: 'fake', prompt_version: 'verlauf-1.1',
    content: {
      header: { session_type: null, session_no: null, setting: 'individual', mode: 'in_person', attendees_extra: '', location: '' },
      ai: {
        homework_followup: {
          status: 'content',
          statements: [statement('aaaaaaaaaaaa', 'Klientin berichtet, das Protokoll an 4 Tagen geführt zu haben.')],
        },
        current_situation: empty,
        topics: {
          status: 'content',
          statements: [
            statement('bbbbbbbbbbbb', 'Klientin wirkte erleichtert.', {
              support: 'unsupported', ai_wording: ['wirkte'], wording: ['wirkte'], blocking: true, refs: [],
            }),
          ],
        },
        interventions: empty, agreements: empty, next_session: empty,
      },
      therapist: { mental_status: '', understanding: '', progress: '', crisis: '', notable: '' },
    },
    default_session_no: 3, blocking: 1, updated_at: '2026-10-08T11:00:00Z', approved_at: null, versions: [],
    ...extra,
  }
}

const SIGNED = {
  note: 'signed-note', transcript: 'signed-transcript', index: 'signed-index',
  signer_fingerprint: 'a'.repeat(64), encrypted_to: ['a'.repeat(64), 'b'.repeat(64)], signed_at: '2026-10-08T12:00:00Z',
}

function signedReport(extra: Record<string, unknown> = {}) {
  return report('signed', {
    content: report('draft', {}).content, // the server sends an empty note; the browser decrypts it
    approved_at: '2026-10-08T12:00:00Z', blocking: 0, signed: SIGNED,
    versions: [{ version: 1, kind: 'approval', created_at: '2026-10-08T12:00:00Z', text: null, message: null }],
    ...extra,
  })
}

function api(handler: (url: string, init: RequestInit) => { status: number; body?: unknown } | undefined) {
  return mockApi((url, init) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: ME }
    if (url.endsWith('/keys')) return { status: 200, body: TEST_KEYS }
    const result = handler(url, init)
    if (result) return result
    if (url.endsWith('/transcript')) return { status: 200, body: TRANSCRIPT }
    if (url.endsWith('/captures')) return { status: 200, body: [] }
    return { status: 200, body: SESSION }
  })
}

describe('session note', () => {
  beforeEach(async () => {
    lock()
    await i18n.changeLanguage('en')
    const note = report('draft').content
    note.ai.topics.statements[0] = { ...note.ai.topics.statements[0], text: 'Klientin berichtet Erleichterung.' }
    Object.assign(OPENED, {
      'signed-note': { session: { id: 's1' }, content: note, ai_assisted: true, approved_at: '2026-10-08T12:00:00Z' },
      'signed-transcript': TRANSCRIPT,
      'signed-index': { session_no: '3', session_type: null, topics: [] },
      'signed:Termin verschoben': { text: 'Termin verschoben', created_at: '2026-10-09T09:00:00Z' },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('jumps to the next sentence to check and shows unsaved changes', async () => {
    api((url) => (url.endsWith('/report') ? { status: 200, body: report('draft') } : undefined))
    renderApp('/sessions/s1/report')
    await screen.findByText('AI draft – not yet reviewed.')
    expect(screen.getByText('Saved')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next to check' }))
    const flagged = screen.getByDisplayValue('Klientin wirkte erleichtert.')
    expect(flagged).toHaveFocus()
    expect(flagged.closest('li')).toHaveClass('selected')

    fireEvent.change(flagged, { target: { value: 'Klientin sagte, sie sei erleichtert.' } })
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next to check' })).not.toBeInTheDocument()
  })

  it('blocks approval until flagged AI sentences are checked, then signs after unlocking', async () => {
    const calls = api((url, init) => {
      if (url.endsWith('/report') && init.method === 'PUT') {
        const current = report('draft')
        current.content.ai.topics.statements[0] = { ...current.content.ai.topics.statements[0], resolved: true, blocking: false }
        return { status: 200, body: { ...current, blocking: 0 } }
      }
      if (url.endsWith('/report/sign/prepare')) {
        return {
          status: 200,
          body: {
            note: {}, index: {}, transcript: TRANSCRIPT, addenda: [], approved_at: '2026-10-08T12:00:00Z',
            report_updated_at: '2026-10-08T11:00:00Z', therapist_fingerprint: 'a'.repeat(64), recovery_fingerprint: 'b'.repeat(64),
          },
        }
      }
      if (url.endsWith('/report/sign')) return { status: 200, body: signedReport() }
      if (url.endsWith('/report')) return { status: 200, body: report('draft') }
      return undefined
    })
    renderApp('/sessions/s1/report')

    expect(await screen.findByText('AI draft – not yet reviewed.')).toBeInTheDocument()
    expect(screen.getByText('Not found in the transcript')).toBeInTheDocument()
    expect(screen.getByText('Wording: wirkte')).toBeInTheDocument()
    expect(screen.getByText(/1 AI sentence still needs your check/)).toBeInTheDocument()
    const approve = screen.getByRole('button', { name: 'Approve and sign' })
    expect(approve).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    await waitFor(() => expect(approve).toBeEnabled()) // once the keys are loaded
    fireEvent.click(approve)
    await confirmInDialog('Approve and sign')

    // The key is locked: the passphrase is asked for first, then signing continues.
    expect(await screen.findByRole('region', { name: 'Unlock to sign' })).toBeInTheDocument()
    expect(calls.some((c) => c.url.endsWith('/sign/prepare'))).toBe(false)
    await unlockWithPassphrase()

    expect(await screen.findByText(/Only you can read this note/)).toBeInTheDocument()
    expect(screen.getByText('Klientin berichtet Erleichterung.')).toBeInTheDocument() // decrypted here
    const signCall = calls.find((c) => c.url.endsWith('/report/sign'))
    expect(signCall?.body).toMatchObject({ note: 'signed-note', transcript: 'signed-transcript', index: 'signed-index' })
    const put = calls.find((c) => c.method === 'PUT')?.body as {
      ai: Record<string, { statements: Record<string, unknown>[] }>
    }
    // Only text and "resolved" are sent; sources and check results stay on the server.
    expect(put.ai.topics.statements[0]).toEqual({
      id: 'bbbbbbbbbbbb', text: 'Klientin wirkte erleichtert.', resolved: true,
    })
    expect(calls.findIndex((c) => c.method === 'PUT')).toBeLessThan(
      calls.findIndex((c) => c.url.endsWith('/report/sign/prepare')),
    )
  })

  it('asks to set up keys before a note can be signed', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/keys')) return { status: 404, body: { code: 'keys_missing' } }
      if (url.endsWith('/report')) return { status: 200, body: report('draft', { blocking: 0 }) }
      if (url.endsWith('/transcript')) return { status: 200, body: TRANSCRIPT }
      return { status: 200, body: SESSION }
    })
    renderApp('/sessions/s1/report')
    expect(await screen.findByText(/Set up your keys first to sign notes/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up keys' })).toHaveAttribute('href', '/keys')
    expect(screen.getByRole('button', { name: 'Approve and sign' })).toBeDisabled()
  })

  it('highlights the transcript lines a sentence is based on', async () => {
    api((url) => (url.endsWith('/report') ? { status: 200, body: report('draft') } : undefined))
    renderApp('/sessions/s1/report')
    const line = await screen.findByText('Ich habe es an vier Tagen geführt.')
    expect(line.closest('li')).not.toHaveClass('source-hit')
    fireEvent.click(screen.getByRole('button', { name: 'Show source' }))
    expect(line.closest('li')).toHaveClass('source-hit')
  })

  it('never shows AI content in the clinical fields', async () => {
    api((url) => (url.endsWith('/report') ? { status: 200, body: report('draft') } : undefined))
    renderApp('/sessions/s1/report')
    expect(await screen.findByText('These fields are never filled by the AI.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Suicidality/ })).toHaveValue('')
  })

  it('offers AI drafting or a manual note before a draft exists', async () => {
    let status = 'none'
    const calls = api((url, init) => {
      if (url.endsWith('/report/draft') && init.method === 'POST') {
        status = 'drafting'
        return { status: 200, body: report('drafting') }
      }
      if (url.endsWith('/report')) return { status: 200, body: report(status, { ai_assisted: false }) }
      return undefined
    })
    const { container } = renderApp('/sessions/s1/report')
    fireEvent.click(await screen.findByRole('button', { name: 'Draft with AI' }))
    expect(await screen.findByText('Writing the draft…')).toBeInTheDocument()
    expect(container.querySelector('.avatar-ring')).toHaveClass('is-processing')
    expect(calls.find((c) => c.url.endsWith('/report/draft'))?.body).toEqual({ field: null })
    expect(screen.queryByRole('button', { name: 'Write manually' })).not.toBeInTheDocument()
  })

  it('lets the therapist leave lines out before the AI draft, and include them again', async () => {
    let excluded = false
    const calls = api((url, init) => {
      if (url.endsWith('/transcript/exclusions') && init.method === 'POST') {
        excluded = (JSON.parse(String(init.body)) as { excluded: boolean }).excluded
      }
      if (url.endsWith('/transcript') || url.endsWith('/transcript/exclusions')) {
        const [first, second] = TRANSCRIPT.segments
        return { status: 200, body: { ...TRANSCRIPT, segments: [first, { ...second, excluded }] } }
      }
      if (url.endsWith('/report')) return { status: 200, body: report('none', { ai_assisted: false }) }
      return undefined
    })
    renderApp('/sessions/s1/report')
    // Names and avatars, not roles; the client line can be left out.
    expect(await screen.findByText('Ich habe es an vier Tagen geführt.')).toBeInTheDocument()
    expect(screen.getByText('Anna Weber')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Leave out the line at 0:04 from the AI draft' }))
    expect(await screen.findByText('Left out of the AI draft')).toBeInTheDocument()
    expect(screen.getByText('1 line left out of the AI draft.')).toBeInTheDocument()
    expect(calls.find((c) => c.url.endsWith('/transcript/exclusions'))?.body).toEqual({
      start_ms: 4100, end_ms: 9000, excluded: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Include the line at 0:04 in the AI draft again' }))
    await waitFor(() => expect(screen.queryByText('Left out of the AI draft')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Draft with AI' })).toBeEnabled()
  })

  it('explains a missing AI consent and allows a manual note', async () => {
    api((url) => (url.endsWith('/report') ? { status: 200, body: report('no_consent') } : undefined))
    renderApp('/sessions/s1/report')
    expect(await screen.findByText(/has not consented to AI processing/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Draft with AI' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write manually' })).toBeEnabled()
  })

  it('opens a signed note after unlocking and adds a signed addendum', async () => {
    const signed = signedReport()
    const calls = api((url, init) => {
      if (url.endsWith('/report/addenda') && init.method === 'POST') {
        const added = { version: 2, kind: 'addendum', created_at: '2026-10-09T09:00:00Z', text: null, message: 'signed:Termin verschoben' }
        return { status: 200, body: { ...signed, versions: [...signed.versions, added] } }
      }
      if (url.endsWith('/report')) return { status: 200, body: signed }
      return undefined
    })
    const { container } = renderApp('/sessions/s1/report')
    expect(await screen.findByRole('region', { name: 'Unlock to read' })).toBeInTheDocument()
    expect(screen.queryByText('Klientin berichtet Erleichterung.')).not.toBeInTheDocument()
    expect(container.querySelector('.ring-badge')).toHaveAttribute('data-badge', 'done')
    await unlockWithPassphrase()

    expect(await screen.findByText('Klientin berichtet Erleichterung.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and sign' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'New addendum' }), { target: { value: 'Termin verschoben' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add addendum' }))
    expect(await screen.findByText('Termin verschoben')).toBeInTheDocument()
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/addenda'))?.body).toEqual({
        message: 'signed:Termin verschoben', signer_fingerprint: 'a'.repeat(64), encrypted_to: ['a'.repeat(64), 'b'.repeat(64)],
      }),
    )
  })

  it('offers to sign a note approved before signing existed; no addenda until then', async () => {
    const approved = report('approved', {
      approved_at: '2026-10-08T12:00:00Z', blocking: 0,
      versions: [{ version: 2, kind: 'addendum', created_at: '2026-10-09T09:00:00Z', text: 'Alter Nachtrag', message: null }],
      signed: null,
    })
    api((url) => (url.endsWith('/report') ? { status: 200, body: approved } : undefined))
    renderApp('/sessions/s1/report')
    expect(await screen.findByText(/approved before signing existed/)).toBeInTheDocument()
    expect(screen.getByText('Alter Nachtrag')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'New addendum' })).not.toBeInTheDocument()
    const signNow = await screen.findByRole('button', { name: 'Sign now' })
    await waitFor(() => expect(signNow).toBeEnabled()) // once the keys are loaded
    fireEvent.click(signNow)
    expect(await screen.findByRole('region', { name: 'Unlock to sign' })).toBeInTheDocument()
  })

  it('shows the signed transcript read-only on the session page', async () => {
    api((url) => {
      if (url.endsWith('/report')) return { status: 200, body: signedReport() }
      if (url.endsWith('/transcript')) return { status: 409, body: { code: 'record_signed' } }
      if (url.endsWith('/sessions/s1')) return { status: 200, body: { ...SESSION, status: 'signed', report_status: 'signed' } }
      return undefined
    })
    renderApp('/sessions/s1')
    expect(await screen.findByRole('link', { name: 'Open note' })).toBeInTheDocument()
    await unlockWithPassphrase()
    expect(await screen.findByText('Ich habe es an vier Tagen geführt.')).toBeInTheDocument()
    expect(screen.getByText(/Signed – part of the record/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /That's me/ })).not.toBeInTheDocument()
  })

  it('shows the note status on the session page', async () => {
    api((url) => (url.endsWith('/report') ? { status: 200, body: report('draft') } : undefined))
    renderApp('/sessions/s1')
    expect(await screen.findByText('Draft – 1 sentence to check')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review note' })).toHaveAttribute('href', '/sessions/s1/report')
  })

  it('lists drafts to review on the Today screen, older ones marked', async () => {
    api((url) =>
      url.endsWith('/sessions')
        ? {
            status: 200,
            body: [
              { ...SESSION, report_status: 'draft', started_at: '2020-01-01T10:00:00Z' },
              { ...SESSION, id: 's2', client_name: 'Ben', report_status: 'approved' },
            ],
          }
        : undefined,
    )
    renderApp('/')
    expect(await screen.findByRole('heading', { name: '1 note to review' })).toBeInTheDocument()
    const notes = within(screen.getByTestId('notes-to-review'))
    expect(notes.getByRole('link', { name: 'Anna Weber' })).toHaveAttribute('href', '/sessions/s1/report')
    expect(notes.getByText(/please complete/)).toBeInTheDocument()
    expect(notes.queryByText('Ben')).not.toBeInTheDocument()
  })

  it('shows the note topics on the session card, not on Today', async () => {
    const sessions = [
      { ...SESSION, report_status: 'draft', report_topics: ['Konflikt am Arbeitsplatz', 'Rückzug'] },
    ]
    api((url) => (url.includes('/sessions?') || url.endsWith('/sessions') ? { status: 200, body: sessions } : undefined))
    const view = renderApp('/sessions')
    expect(await screen.findByText(/Konflikt am Arbeitsplatz · Rückzug/)).toBeInTheDocument()
    expect(screen.getByText('Draft:')).toBeInTheDocument()
    view.unmount()

    renderApp('/')
    expect(await screen.findByRole('heading', { name: '1 note to review' })).toBeInTheDocument()
    expect(screen.queryByText(/Konflikt/)).not.toBeInTheDocument()
  })
})
