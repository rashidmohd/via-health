import { fireEvent, screen, within } from '@testing-library/react'
import i18n from '../../i18n'
import { ME, mockApi, renderApp } from '../../test-utils'

const BASE = {
  client_id: 'c1', ended_at: null, audio_state: 'present', duration_ms: 3_000_000, total_chunks: 300,
  uploaded_chunks: 300, failure_reason: null, transcribed_ms: 0, report_topics: [], started_at: '2026-10-08T10:00:00Z',
}
const SESSIONS = [
  { ...BASE, id: 's1', client_name: 'Anna Weber', status: 'transcribed', report_status: 'draft' },
  { ...BASE, id: 's2', client_name: 'Ben Braun', status: 'processing', report_status: null },
  { ...BASE, id: 's3', client_name: 'Clara Schmidt', status: 'transcribed', report_status: 'approved' },
]

describe('sessions page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/sessions')) return { status: 200, body: SESSIONS }
      return { status: 200, body: { items: [], unread: 0, notes_to_review: 0 } }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists sessions with status and filters them', async () => {
    renderApp('/sessions')
    const anna = (await screen.findByRole('link', { name: 'Anna Weber' })).closest('tr')!
    expect(anna.querySelector('a')).toHaveAttribute('href', '/sessions/s1')
    expect(within(anna).getByText('Draft – ready to review')).toBeInTheDocument()
    expect(screen.getByText('3 sessions')).toBeInTheDocument()

    const filters = screen.getByRole('group', { name: 'Show' })
    fireEvent.click(within(filters).getByRole('button', { name: /To review/ }))
    expect(screen.getByText('Anna Weber')).toBeInTheDocument()
    expect(screen.queryByText('Ben Braun')).not.toBeInTheDocument()

    fireEvent.click(within(filters).getByRole('button', { name: /In progress/ }))
    expect(screen.getByText('Ben Braun')).toBeInTheDocument()
    expect(screen.queryByText('Clara Schmidt')).not.toBeInTheDocument()
  })

  it('searches by client name', async () => {
    renderApp('/sessions')
    await screen.findByText('Anna Weber')
    fireEvent.change(screen.getByPlaceholderText('Search by client'), { target: { value: 'clara' } })
    expect(screen.getByText('Clara Schmidt')).toBeInTheDocument()
    expect(screen.queryByText('Anna Weber')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search by client'), { target: { value: 'zzz' } })
    expect(screen.getByText('No session matches.')).toBeInTheDocument()
  })
})
