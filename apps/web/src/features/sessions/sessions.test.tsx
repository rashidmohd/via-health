import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import i18n from '../../i18n'
import { createSessionKey } from '../../recorder/crypto'
import { db } from '../../recorder/db'
import { setVoiceStateForTest } from '../../recorder/micMonitor'
import { installFakeMicrophone } from '../../recorder/testing'
import { confirmInDialog, ME, mockApi, renderApp, TEST_KEYS } from '../../test-utils'

// Wrapping the session key to the therapist key (plan 0014 step C); real OpenPGP in crypto tests.
vi.mock('../../crypto/pgp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../crypto/pgp')>()),
  wrapSessionKey: vi.fn(async () => '-----BEGIN PGP MESSAGE-----'),
}))

function summary(id: string, name: string, ready: boolean) {
  return {
    id,
    name,
    preferred_language: 'de',
    status: 'active',
    consent: {
      recording: ready ? 'granted' : 'missing',
      ai_processing: ready ? 'granted' : 'missing',
      product_improvement: 'missing',
    },
    ready_to_record: ready,
    last_session_at: null,
    created_at: '2026-10-08T10:00:00Z',
  }
}

const ANNA = summary('c1', 'Anna Weber', true)
const BEN = summary('c2', 'Ben Braun', false)

function api(overrides: (url: string, init: RequestInit) => { status: number; body?: unknown } | null = () => null) {
  return mockApi((url, init) => {
    const special = overrides(url, init)
    if (special) return special
    if (url.endsWith('/auth/me')) return { status: 200, body: ME }
    if (url.endsWith('/keys')) return { status: 200, body: TEST_KEYS }
    if (url.endsWith('/clients')) return { status: 200, body: [ANNA, BEN] }
    if (url.endsWith('/clients/c1')) return { status: 200, body: { ...ANNA, identity: { name: 'Anna Weber' }, consents: [] } }
    if (url.endsWith('/clients/c2')) return { status: 200, body: { ...BEN, identity: { name: 'Ben Braun' }, consents: [] } }
    if (url.includes('/sessions') && (init.method ?? 'GET') === 'GET') return { status: 200, body: [] }
    return { status: 204 }
  })
}

/** The button is enabled once consent and the therapist keys are loaded. */
async function startRecording() {
  const button = await screen.findByRole('button', { name: 'Start recording' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

describe('start session flow', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    await Promise.all([db.sessions.clear(), db.chunks.clear(), db.consent.clear()])
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lets you choose only clients with consent', async () => {
    api()
    renderApp('/sessions/new')
    const anna = await screen.findByRole('link', { name: /Anna Weber/ })
    expect(anna).toHaveAttribute('href', '/sessions/record/c1')
    expect(screen.queryByRole('link', { name: /Ben Braun/ })).not.toBeInTheDocument()
    expect(screen.getByText('Ben Braun').closest('[aria-disabled="true"]')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Record consent' })).toHaveAttribute('href', '/clients/c2/consent')
  })

  it('uses the consent status saved on the device when offline', async () => {
    api()
    const view = renderApp('/sessions/new')
    await screen.findByRole('link', { name: /Anna Weber/ })
    await waitFor(async () => expect(await db.consent.count()).toBe(2))
    view.unmount()

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/me')
          ? new Response(JSON.stringify(ME), { status: 200 })
          : Promise.reject(new TypeError('offline')),
      ),
    )
    renderApp('/sessions/new')
    expect(await screen.findByText(/Offline: showing the consent status/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Anna Weber/ })).toBeInTheDocument()
  })

  it('needs the therapist keys before recording (plan 0014 step C)', async () => {
    installFakeMicrophone()
    api((url) => (url.endsWith('/keys') ? { status: 404, body: { code: 'keys_missing' } } : null))
    renderApp('/sessions/record/c1')
    expect(await screen.findByText(/Set up your keys first/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up keys' })).toHaveAttribute('href', '/keys')
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled()
  })

  it('records after choosing the client, then stops with confirmation', async () => {
    installFakeMicrophone()
    api()
    renderApp('/sessions/record/c1')

    await startRecording()
    expect(await screen.findByRole('status')).toHaveTextContent('Recording')
    expect(screen.getByLabelText('Recording time')).toHaveTextContent('00:00')

    // Voice activity: binary, shown by the ring around the paused avatar, and as text.
    const ring = document.querySelector('.record-stage .avatar-ring')!
    expect(ring).toHaveClass('is-silent')
    act(() => setVoiceStateForTest({ status: 'on', active: true, lastVoiceAt: Date.now() }))
    expect(ring).toHaveClass('is-listening')
    expect(screen.getByText('Voice detected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    await confirmInDialog('Stop recording')
    expect(await screen.findByText('Recording saved.')).toBeInTheDocument()
    const [session] = await db.sessions.toArray()
    expect(screen.getByRole('link', { name: 'Open session' })).toHaveAttribute(
      'href',
      `/sessions/${session.id}`,
    )
    expect(session.clientId).toBe('c1')
    expect(['stopped', 'synced']).toContain(session.status)
  })

  it('minimises a running recording to a dock on other screens, with problems and stop', async () => {
    const track = installFakeMicrophone()
    api()
    renderApp('/sessions/record/c1')
    await startRecording()
    await screen.findByLabelText('Recording time')
    expect(screen.queryByRole('complementary', { name: 'Running recording' })).not.toBeInTheDocument()

    // Leaving the recording screen keeps recording and says so.
    fireEvent.click(screen.getByRole('link', { name: 'Clients' }))
    const dock = await screen.findByRole('complementary', { name: 'Running recording' })
    expect(within(dock).getByText('Anna Weber')).toBeInTheDocument()
    expect(within(dock).getByText('The recording continues in the background.')).toBeInTheDocument()
    expect(within(dock).getByRole('link', { name: 'Back to recording' })).toHaveAttribute('href', '/sessions/record/c1')

    // A problem reaches the user on whatever screen they are on.
    act(() => track.onended?.())
    expect(within(dock).getByRole('alert')).toHaveTextContent('The microphone was disconnected.')

    // Cancel keeps recording; confirming stops and opens the session.
    fireEvent.click(within(dock).getByRole('button', { name: 'Stop recording' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Running recording' })).toBeInTheDocument()

    fireEvent.click(within(dock).getByRole('button', { name: 'Stop recording' }))
    await confirmInDialog('Stop recording')
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Running recording' })).not.toBeInTheDocument(),
    )
    const [session] = await db.sessions.toArray()
    expect(['stopped', 'synced']).toContain(session.status)
  })

  it('asks before signing out while recording', async () => {
    installFakeMicrophone()
    const calls = api()
    renderApp('/sessions/record/c1')
    await startRecording()
    await screen.findByLabelText('Recording time')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('A recording is running.')
    // Destructive questions start on Cancel; Escape cancels.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(calls.some((c) => c.url.endsWith('/auth/logout'))).toBe(false)
    expect(screen.getByLabelText('Recording time')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await confirmInDialog('Stop and sign out')
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/auth/logout'))).toBe(true))
    const [session] = await db.sessions.toArray()
    expect(session.status).not.toBe('recording')
  })

  it('does not allow recording without consent', async () => {
    api()
    renderApp('/sessions/record/c2')
    expect(await screen.findByRole('button', { name: 'Start recording' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Record consent' })).toBeInTheDocument()
  })

  it('offers to recover an interrupted recording', async () => {
    const { key } = await createSessionKey()
    await db.sessions.put({
      id: 'lost',
      clientId: 'c1',
      clientName: 'Anna Weber',
      status: 'recording',
      startedAt: '2026-10-08T10:00:00.000Z',
      mimeType: 'audio/webm;codecs=opus',
      nextSeq: 3,
      key,
      serverCreated: true,
      keyUploaded: true,
      finished: false,
    })
    api()
    renderApp('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Finish and upload' }))
    await waitFor(async () => expect((await db.sessions.get('lost'))?.status).not.toBe('recording'))
    expect((await db.sessions.get('lost'))?.durationMs).toBe(30_000)
  })

  it('shows German labels', async () => {
    await i18n.changeLanguage('de')
    api()
    renderApp('/sessions/record/c1')
    expect(await screen.findByRole('button', { name: 'Aufnahme starten' })).toBeInTheDocument()
  })
})
