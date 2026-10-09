import { act, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../i18n'
import { ModelPreloadBanner } from './ModelPreloadBanner'

const preload = vi.hoisted(() => ({
  calls: [] as (string | undefined)[],
  state: { status: 'idle' } as { status: string; progress?: number },
  listeners: new Set<() => void>(),
}))

vi.mock('../../live-stt/preview', () => ({ livePreviewSupported: () => true }))
vi.mock('../../live-stt/modelCache', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    preloadLiveModels: async (first?: string) => void preload.calls.push(first),
    usePreloadState: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          preload.listeners.add(listener)
          return () => preload.listeners.delete(listener)
        },
        () => preload.state,
      ),
  }
})

function setState(state: { status: string; progress?: number }) {
  act(() => {
    preload.state = state
    preload.listeners.forEach((listener) => listener())
  })
}

describe('model preload banner', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    localStorage.clear()
    preload.calls = []
    preload.state = { status: 'idle' }
  })

  it('starts the download when the app opens and shows the progress until it is ready', () => {
    render(<ModelPreloadBanner />)
    expect(preload.calls).toEqual(['en'])
    setState({ status: 'loading', progress: 0.42 })
    expect(screen.getByText(/Loading the live transcript model \(42 %\)/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '42')
    setState({ status: 'ready' })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('can be hidden for this visit', () => {
    render(<ModelPreloadBanner />)
    setState({ status: 'loading', progress: 0.1 })
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does nothing when turned off in Settings or when the live preview is off', () => {
    localStorage.setItem('sessio.livePreload', 'off')
    const { unmount } = render(<ModelPreloadBanner />)
    unmount()
    localStorage.clear()
    localStorage.setItem('sessio.livePreview', 'off')
    render(<ModelPreloadBanner />)
    setState({ status: 'loading', progress: 0.5 })
    expect(preload.calls).toEqual([])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says so when the download failed', () => {
    render(<ModelPreloadBanner />)
    setState({ status: 'error' })
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument()
  })
})
