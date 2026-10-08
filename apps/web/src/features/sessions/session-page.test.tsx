import { fireEvent, screen } from '@testing-library/react'
import i18n from '../../i18n'
import { ME, mockApi, renderApp } from '../../test-utils'

function session(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 's1', client_id: 'c1', client_name: 'Anna Weber', started_at: '2026-10-08T10:00:00Z',
    ended_at: null, status, audio_state: 'present', duration_ms: 3_000_000, total_chunks: 300,
    uploaded_chunks: 300, failure_reason: null, ...extra,
  }
}

const TRANSCRIPT = {
  session_id: 's1', language: 'de-DE', stt_model: 'chirp_3', therapist_speaker: null as string | null,
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
    expect(await screen.findAllByText('Therapist')).toHaveLength(2)
    expect(screen.getByText('Client')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Which speaker are you?' })).not.toBeInTheDocument()
    // Speaker 0 said the most, so it is listed first.
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ therapist_speaker: '0' })
    expect(screen.getByText('0:04')).toBeInTheDocument()
  })

  it('shows German labels', async () => {
    await i18n.changeLanguage('de')
    mockApi((url) => (url.endsWith('/auth/me') ? { status: 200, body: ME } : { status: 200, body: session('processing') }))
    renderApp('/sessions/s1')
    expect(await screen.findByRole('status')).toHaveTextContent('Wird transkribiert…')
  })
})
