import { fireEvent, screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n'
import { ME, mockApi, renderApp } from '../../test-utils'

const ITEMS = [
  { id: 'n1', kind: 'report_ready', session_id: 's1', client_name: 'Anna Weber', created_at: '2026-10-09T09:00:00Z', read: false },
  { id: 'n2', kind: 'transcription_failed', session_id: 's2', client_name: 'Ben Roth', created_at: '2026-10-08T09:00:00Z', read: true },
]

describe('notifications tab', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(() => vi.unstubAllGlobals())

  function api(unread = 1) {
    return mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/notifications/read')) return { status: 204 }
      if (url.endsWith('/notifications')) return { status: 200, body: { items: ITEMS, unread, notes_to_review: 2 } }
      return { status: 200, body: [] }
    })
  }

  it('shows the unread count in the sidebar', async () => {
    api(3)
    renderApp('/')
    expect(await screen.findByLabelText('3 unread notifications')).toHaveTextContent('3')
  })

  it('lists events with links and marks one as read when opened', async () => {
    const calls = api()
    renderApp('/notifications')
    const ready = await screen.findByRole('link', { name: /Note draft ready/ })
    expect(ready).toHaveAttribute('href', '/sessions/s1/report')
    expect(screen.getByRole('link', { name: /Transcription failed/ })).toHaveAttribute('href', '/sessions/s2')
    expect(screen.getByText('2 note drafts are waiting for your review.')).toBeInTheDocument()

    fireEvent.click(ready)
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/notifications/read'))?.body).toEqual({ ids: ['n1'] }),
    )
  })

  it('marks all as read', async () => {
    const calls = api()
    renderApp('/notifications')
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }))
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/notifications/read'))?.body).toEqual({ all: true }),
    )
  })
})
