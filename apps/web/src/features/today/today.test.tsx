import { screen, within } from '@testing-library/react'
import i18n from '../../i18n'
import { ME, mockApi, renderApp } from '../../test-utils'

const BASE = {
  client_id: 'c1', ended_at: null, status: 'transcribed', audio_state: 'present', duration_ms: 3_000_000,
  total_chunks: 300, uploaded_chunks: 300, failure_reason: null, transcribed_ms: 0, report_topics: [],
}

describe('today', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(() => vi.unstubAllGlobals())

  it("counts today's sessions and lists them; older sessions stay off the list", async () => {
    const sessions = [
      { ...BASE, id: 's1', client_name: 'Anna Weber', started_at: new Date().toISOString(), report_status: 'approved' },
      { ...BASE, id: 's2', client_name: 'Ben Braun', started_at: '2020-01-01T10:00:00Z', report_status: 'approved' },
    ]
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/sessions')) return { status: 200, body: sessions }
      return { status: 200, body: { items: [], unread: 0, notes_to_review: 0 } }
    })
    renderApp('/')
    const tile = (await screen.findByText('Sessions today')).closest('.stat')!
    expect(await within(tile as HTMLElement).findByText('1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Anna Weber' })).toHaveAttribute('href', '/sessions/s1')
    expect(screen.queryByText('Ben Braun')).not.toBeInTheDocument()
    expect(screen.getByText('No notes waiting for review.')).toBeInTheDocument()
  })

  it('shows empty states when nothing happened today', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/sessions')) return { status: 200, body: [] }
      return { status: 200, body: { items: [], unread: 0, notes_to_review: 0 } }
    })
    renderApp('/')
    expect(await screen.findByText('No sessions recorded today yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notes to review' })).toBeInTheDocument()
  })
})
