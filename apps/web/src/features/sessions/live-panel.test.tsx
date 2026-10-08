import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18n from '../../i18n'
import type { PreviewEvent } from '../../live-stt/preview'
import type { SessionRecorder } from '../../recorder/recorder'
import { mockApi } from '../../test-utils'
import { LivePanel } from './LivePanel'

const preview = vi.hoisted(() => ({
  emit: null as null | ((event: PreviewEvent) => void),
  starts: 0,
  stops: 0,
}))

vi.mock('../../live-stt/preview', () => ({
  livePreviewSupported: () => true,
  LivePreview: {
    start: async (_stream: MediaStream, _offset: number, onEvent: (event: PreviewEvent) => void) => {
      preview.starts++
      preview.emit = onEvent
      return { stop: () => preview.stops++ }
    },
  },
}))

const recorder = { mediaStream: {} as MediaStream, elapsedMs: () => 0 } as unknown as SessionRecorder

function renderPanel(language: 'de' | 'en' = 'de') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <LivePanel sessionId="s1" recorder={recorder} language={language} />
    </QueryClientProvider>,
  )
}

function openPanel() {
  const details = screen.getByText('Transcript so far').closest('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
}

describe('live panel', () => {
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

  it('starts the preview only when opened, then shows device text and chips', async () => {
    renderPanel()
    expect(preview.starts).toBe(0)
    openPanel()
    await vi.waitFor(() => expect(preview.starts).toBe(1))

    act(() => preview.emit!({ type: 'loading', loaded: 50, total: 100 }))
    expect(screen.getByText(/Loading the speech model \(50 %\)/)).toBeInTheDocument()
    act(() => preview.emit!({ type: 'ready' }))
    expect(screen.getByText('Live preview on this device')).toBeInTheDocument()

    act(() => preview.emit!({ type: 'partial', text: 'Wir sehen uns', startMs: 1000 }))
    expect(screen.getByText('Wir sehen uns')).toBeInTheDocument()
    act(() =>
      preview.emit!({ type: 'final', text: 'Wir sehen uns Donnerstag, gleiche Zeit.', startMs: 1000, endMs: 4000 }),
    )
    expect(screen.getAllByText('Wir sehen uns Donnerstag, gleiche Zeit.').length).toBeGreaterThan(0)
    expect(screen.getByText('Appointment')).toBeInTheDocument()
  })

  it('keeps recording-safe: too slow stops only the preview', async () => {
    renderPanel()
    openPanel()
    await vi.waitFor(() => expect(preview.starts).toBe(1))
    act(() => preview.emit!({ type: 'too_slow' }))
    expect(screen.getByText(/this device is too slow/)).toBeInTheDocument()
    expect(preview.stops).toBe(1)
  })

  it('German only for now', async () => {
    renderPanel('en')
    openPanel()
    expect(await screen.findByText(/available for German only/)).toBeInTheDocument()
    expect(preview.starts).toBe(0)
  })

  it('can be switched off per device and remembers it', async () => {
    renderPanel()
    openPanel()
    await vi.waitFor(() => expect(preview.starts).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Turn off live preview on this device' }))
    expect(preview.stops).toBe(1)
    expect(localStorage.getItem('sessio.livePreview')).toBe('off')
    expect(screen.getByText(/Live preview is off on this device/)).toBeInTheDocument()
  })
})
