import { fireEvent, screen, within } from '@testing-library/react'
import i18n from '../../i18n'
import { ME, mockApi, renderApp } from '../../test-utils'

const REPORTS = [
  {
    session_id: 's1', client_id: 'c1', client_name: 'Anna Weber', started_at: '2026-10-08T10:00:00Z',
    approved_at: '2026-10-08T15:00:00Z', session_no: '3', session_type: 'short_term',
    topics: ['Schlaf', 'Arbeit'], addenda: 1,
  },
  {
    session_id: 's2', client_id: 'c2', client_name: 'Ben Braun', started_at: '2026-10-01T09:00:00Z',
    approved_at: '2026-10-01T12:00:00Z', session_no: '1', session_type: null, topics: [], addenda: 0,
  },
]

function stub(reports: unknown[]) {
  mockApi((url) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: ME }
    if (url.endsWith('/reports')) return { status: 200, body: reports }
    return { status: 200, body: { items: [], unread: 0, notes_to_review: 0 } }
  })
}

describe('reports page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists approved notes and links to the note', async () => {
    stub(REPORTS)
    renderApp('/reports')
    const anna = (await screen.findByRole('link', { name: 'Anna Weber' })).closest('tr')!
    expect(within(anna).getByRole('link')).toHaveAttribute('href', '/sessions/s1/report')
    expect(within(anna).getByText('Session 3')).toBeInTheDocument()
    expect(within(anna).getByText('Short-term therapy')).toBeInTheDocument()
    expect(within(anna).getByText('Schlaf · Arbeit')).toBeInTheDocument()
    expect(within(anna).getByText('1 addendum')).toBeInTheDocument()
    expect(screen.getByText('2 approved notes')).toBeInTheDocument()
  })

  it('searches by client name', async () => {
    stub(REPORTS)
    renderApp('/reports')
    await screen.findByText('Anna Weber')
    fireEvent.change(screen.getByPlaceholderText('Search by client'), { target: { value: 'ben' } })
    expect(screen.getByText('Ben Braun')).toBeInTheDocument()
    expect(screen.queryByText('Anna Weber')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search by client'), { target: { value: 'zzz' } })
    expect(screen.getByText('No note matches.')).toBeInTheDocument()
  })

  it('explains the empty state in German', async () => {
    await i18n.changeLanguage('de')
    stub([])
    renderApp('/reports')
    expect(await screen.findByText('Noch keine freigegebenen Dokumentationen.')).toBeInTheDocument()
  })
})
