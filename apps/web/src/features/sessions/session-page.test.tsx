import { fireEvent, screen } from '@testing-library/react'
import i18n from '../../i18n'
import { ME, mockApi, renderApp } from '../../test-utils'

function session(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 's1', client_id: 'c1', client_name: 'Anna Weber', started_at: '2026-10-08T10:00:00Z',
    ended_at: null, status, audio_state: 'present', duration_ms: 3_000_000, total_chunks: 300,
    uploaded_chunks: 300, failure_reason: null, transcribed_ms: 0, ...extra,
  }
}

const TRANSCRIPT = {
  session_id: 's1', language: 'de-DE', stt_model: 'chirp_3', therapist_speaker: null as string | null,
  refine_status: 'done', corrections: 0,
  segments: [
    { speaker: '0', start_ms: 0, end_ms: 4100, text: 'Guten Tag, wie ist es Ihnen ergangen?' },
    { speaker: '1', start_ms: 4200, end_ms: 9500, text: 'Ehrlich gesagt etwas besser, danke für die Frage.' },
    { speaker: '0', start_ms: 10_000, end_ms: 13_200, text: 'Das freut mich.' },
  ],
}

describe('session page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows progress while transcribing', async () => {
    mockApi((url) => (url.endsWith('/auth/me') ? { status: 200, body: ME } : { status: 200, body: session('processing') }))
    renderApp('/sessions/s1')
    expect(await screen.findByRole('status')).toHaveTextContent('Transcribing…')
  })

  it('shows a failure with retry', async () => {
    const calls = mockApi((url, init) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/retry') && init.method === 'POST') return { status: 200, body: session('uploaded') }
      return { status: 200, body: session('failed', { failure_reason: 'transcription_failed' }) }
    })
    renderApp('/sessions/s1')
    expect(await screen.findByText(/did not respond/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Transcribing…')
    expect(calls.some((c) => c.url.endsWith('/sessions/s1/retry'))).toBe(true)
  })

  it('asks who the therapist is, then labels the transcript', async () => {
    let therapist: string | null = null
    const calls = mockApi((url, init) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/captures')) return { status: 200, body: [] }
      if (url.endsWith('/transcript')) {
        if (init.method === 'PATCH') therapist = (JSON.parse(String(init.body)) as { therapist_speaker: string }).therapist_speaker
        return { status: 200, body: { ...TRANSCRIPT, therapist_speaker: therapist } }
      }
      return { status: 200, body: session('transcribed') }
    })
    renderApp('/sessions/s1')
    expect(await screen.findByRole('heading', { name: 'Which speaker are you?' })).toBeInTheDocument()
    expect(screen.getAllByText('Speaker 0').length).toBeGreaterThan(0)

    const [speaker0] = screen.getAllByRole('button', { name: "That's me" })
    fireEvent.click(speaker0)
    expect(await screen.findAllByRole('button', { name: /^Therapist at/ })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^Client at/ })).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Which speaker are you?' })).not.toBeInTheDocument()
    // Speaker 0 said the most, so it is listed first.
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ therapist_speaker: '0' })
    expect(screen.getByText('0:04')).toBeInTheDocument()
  })

  it('suggests notes from the transcript and saves the decision', async () => {
    const saved: unknown[] = []
    mockApi((url, init) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/captures')) {
        if (init.method === 'POST') {
          saved.push(JSON.parse(String(init.body)))
          return { status: 200, body: {} }
        }
        return {
          status: 200,
          body: [{ id: 'b1', kind: 'bookmark', key: 'bookmark:4500', at_ms: 4500, text: '', status: 'suggested' }],
        }
      }
      if (url.endsWith('/transcript')) {
        return {
          status: 200,
          body: {
            ...TRANSCRIPT,
            therapist_speaker: '0',
            segments: [
              ...TRANSCRIPT.segments,
              { speaker: '0', start_ms: 14_000, end_ms: 18_000, text: 'Schreiben Sie bis nächste Woche Ihre Gedanken auf.' },
            ],
          },
        }
      }
      return { status: 200, body: session('transcribed') }
    })
    renderApp('/sessions/s1')
    expect(await screen.findByRole('heading', { name: 'Notes from the session' })).toBeInTheDocument()
    // Bookmark shows what was said at that moment
    expect(screen.getAllByText('Ehrlich gesagt etwas besser, danke für die Frage.').length).toBeGreaterThan(1)
    const keep = screen.getAllByRole('button', { name: 'Keep' })
    expect(keep).toHaveLength(2)
    fireEvent.click(keep[1])
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]).toMatchObject({
      kind: 'action_item',
      status: 'confirmed',
      text: 'Schreiben Sie bis nächste Woche Ihre Gedanken auf.',
    })
  })

  it('lets the therapist correct speakers, swap from a line on, and undo', async () => {
    const posts: { url: string; body: unknown }[] = []
    mockApi((url, init) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/captures')) return { status: 200, body: [] }
      if (url.includes('/transcript')) {
        if (init.method === 'POST') posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })
        return { status: 200, body: { ...TRANSCRIPT, therapist_speaker: '0', corrections: posts.length } }
      }
      return { status: 200, body: session('transcribed') }
    })
    renderApp('/sessions/s1')
    // Client line at 0:04 → switch to therapist
    fireEvent.click(await screen.findByRole('button', { name: 'Client at 0:04 — switch to Therapist' }))
    await vi.waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].body).toEqual({ correction: { op: 'set', at_ms: 4200, speaker: '0' } })

    fireEvent.click(screen.getByRole('button', { name: 'Swap therapist and client from 0:10 on' }))
    await vi.waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1].body).toEqual({ correction: { op: 'swap_from', at_ms: 10_000, a: '0', b: '1' } })

    fireEvent.click(await screen.findByRole('button', { name: 'Undo last correction' }))
    await vi.waitFor(() => expect(posts).toHaveLength(3))
    expect(posts[2].url).toMatch(/\/transcript\/speakers\/undo$/)
  })

  it('says when speakers are still being checked', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: ME }
      if (url.endsWith('/captures')) return { status: 200, body: [] }
      if (url.endsWith('/transcript')) {
        return { status: 200, body: { ...TRANSCRIPT, therapist_speaker: '0', refine_status: 'running' } }
      }
      return { status: 200, body: session('transcribed') }
    })
    renderApp('/sessions/s1')
    expect(await screen.findByText(/Checking who said what/)).toBeInTheDocument()
  })

  it('shows how much is transcribed while still recording', async () => {
    mockApi((url) =>
      url.endsWith('/auth/me')
        ? { status: 200, body: ME }
        : { status: 200, body: session('recording', { transcribed_ms: 144_000, uploaded_chunks: 150 }) },
    )
    renderApp('/sessions/s1')
    expect(await screen.findByText('Transcribed so far: 2 minutes')).toBeInTheDocument()
  })

  it('shows German labels', async () => {
    await i18n.changeLanguage('de')
    mockApi((url) => (url.endsWith('/auth/me') ? { status: 200, body: ME } : { status: 200, body: session('processing') }))
    renderApp('/sessions/s1')
    expect(await screen.findByRole('status')).toHaveTextContent('Wird transkribiert…')
  })
})
