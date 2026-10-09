import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18n from '../../i18n'
import type { PreviewEvent } from '../../live-stt/preview'
import type { SessionRecorder } from '../../recorder/recorder'
import { mockApi } from '../../test-utils'
import { LivePanel } from './LivePanel'
import { useLivePreview } from './useLivePreview'

const preview = vi.hoisted(() => ({
  emit: null as null | ((event: PreviewEvent) => void),
  starts: 0,
  stops: 0,
  language: '',
}))

vi.mock('../../live-stt/preview', () => ({
  livePreviewSupported: () => true,
  LivePreview: {
    start: async (
      _stream: MediaStream,
      _offset: number,
      language: string,
      onEvent: (event: PreviewEvent) => void,
    ) => {
      preview.starts++
      preview.language = language
      preview.emit = onEvent
      return { stop: () => preview.stops++ }
    },
  },
}))

const recorder = { mediaStream: {} as MediaStream, elapsedMs: () => 0 } as unknown as SessionRecorder

/** Same wiring as the record page: one engine feeding the transcript. */
function Stage({ language }: { language: string }) {
  const live = useLivePreview(recorder, language as 'de')
  return (
    <div data-testid="transcript">
      <LivePanel sessionId="s1" live={live} />
    </div>
  )
}

function renderStage(language: string = 'de') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Stage language={language} />
    </QueryClientProvider>,
  )
}

const transcript = () => screen.getByTestId('transcript')
const lines = (hidden = false) =>
  within(screen.getByTestId('transcript').querySelector('ol')!).getAllByRole('listitem', { hidden })

describe('live transcript', () => {
  let server: { covered_ms: number; segments: unknown[] }

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    preview.starts = 0
    preview.stops = 0
    localStorage.clear()
    server = { covered_ms: 0, segments: [] }
    mockApi(() => ({ status: 200, body: server }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('starts one engine right away; the sentence in progress is the last line', async () => {
    renderStage()
    await vi.waitFor(() => expect(preview.starts).toBe(1))

    act(() => preview.emit!({ type: 'loading', loaded: 50, total: 100 }))
    expect(transcript()).toHaveTextContent(/Loading the speech model \(50 %\)/)
    act(() => preview.emit!({ type: 'ready' }))
    expect(transcript()).toHaveTextContent(/Listening\. Words appear here/)

    act(() => preview.emit!({ type: 'final', text: 'Guten Tag.', startMs: 0, endMs: 900 }))
    act(() => preview.emit!({ type: 'partial', text: 'Wir sehen uns', startMs: 1000 }))
    const items = lines(true)
    expect(items.at(-1)).toHaveTextContent('Wir sehen uns')
    expect(items.at(-1)).toHaveAttribute('aria-hidden', 'true') // not announced while it changes
    expect(items.at(-1)).toHaveClass('source-partial')
    expect(screen.queryByText('Appointment')).toBeNull()

    act(() =>
      preview.emit!({ type: 'final', text: 'Wir sehen uns Donnerstag, gleiche Zeit.', startMs: 1000, endMs: 4000 }),
    )
    const finished = lines()
    expect(finished).toHaveLength(2)
    expect(finished[1]).toHaveTextContent('Wir sehen uns Donnerstag, gleiche Zeit.')
    expect(finished[1]).not.toHaveAttribute('aria-hidden')
    expect(screen.getByText('Appointment')).toBeInTheDocument()
  })

  it('shows server text with speakers at the bottom, replacing covered device lines', async () => {
    server = { covered_ms: 60_000, segments: [{ speaker: '1', start_ms: 0, end_ms: 5000, text: 'Guten Morgen.' }] }
    renderStage()
    await vi.waitFor(() => expect(preview.starts).toBe(1))
    act(() => preview.emit!({ type: 'final', text: 'Guten Morgn', startMs: 0, endMs: 5000 }))
    await vi.waitFor(() => expect(transcript()).toHaveTextContent('Guten Morgen.'))
    expect(transcript()).not.toHaveTextContent('Guten Morgn')
  })

  it('keeps recording-safe: too slow stops only the preview', async () => {
    renderStage()
    await vi.waitFor(() => expect(preview.starts).toBe(1))
    act(() => preview.emit!({ type: 'too_slow' }))
    expect(transcript()).toHaveTextContent(/this device is too slow/)
    expect(preview.stops).toBe(1)
  })

  it('runs the English model for English-speaking clients', async () => {
    renderStage('en')
    await vi.waitFor(() => expect(preview.starts).toBe(1))
    expect(preview.language).toBe('en')
  })

  it('says so for a language without a model', async () => {
    renderStage('fr')
    expect(await within(transcript()).findByText(/not available for this language yet/)).toBeInTheDocument()
    expect(preview.starts).toBe(0)
  })

  it('can be switched off per device and remembers it', async () => {
    renderStage()
    await vi.waitFor(() => expect(preview.starts).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Turn off live preview on this device' }))
    expect(preview.stops).toBe(1)
    expect(localStorage.getItem('sessio.livePreview')).toBe('off')
    expect(transcript()).toHaveTextContent(/Live preview is off on this device/)
  })
})
