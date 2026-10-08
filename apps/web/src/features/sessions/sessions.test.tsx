import { fireEvent, screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n'
import { createSessionKey } from '../../recorder/crypto'
import { db } from '../../recorder/db'
import { installFakeMicrophone } from '../../recorder/testing'
import { ME, mockApi, renderApp } from '../../test-utils'

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
    if (url.endsWith('/clients')) return { status: 200, body: [ANNA, BEN] }
    if (url.endsWith('/clients/c1')) return { status: 200, body: { ...ANNA, identity: { name: 'Anna Weber' }, consents: [] } }
    if (url.endsWith('/clients/c2')) return { status: 200, body: { ...BEN, identity: { name: 'Ben Braun' }, consents: [] } }
    if (url.includes('/sessions') && (init.method ?? 'GET') === 'GET') return { status: 200, body: [] }
    return { status: 204 }
  })
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

  it('records after choosing the client, then stops with confirmation', async () => {
    installFakeMicrophone()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    api()
    renderApp('/sessions/record/c1')

    fireEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Recording')
    expect(screen.getByLabelText('Recording time')).toHaveTextContent('00:00')

    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(await screen.findByText('Recording saved.')).toBeInTheDocument()
    const [session] = await db.sessions.toArray()
    expect(session.clientId).toBe('c1')
    expect(['stopped', 'synced']).toContain(session.status)
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
