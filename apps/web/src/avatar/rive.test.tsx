import { act, fireEvent, render, screen } from '@testing-library/react'
import { RiveAvatar } from './RiveAvatar'
import RiveCanvas from './RiveCanvas'
import { EMOTION, PAUSE_AFTER_MS, resetRiveFileForTest } from './rive'

const rive = vi.hoisted(() => ({
  instance: { play: vi.fn(), pause: vi.fn() },
  inputs: {} as Record<string, { value: number | boolean; fire: () => void }>,
  params: null as null | { onLoadError?: () => void; buffer?: ArrayBuffer },
  wasm: [] as (string | null)[],
}))

vi.mock('@rive-app/react-canvas', () => ({
  RuntimeLoader: {
    setWasmUrl: (url: string) => rive.wasm.push(url),
    setWasmFallbackUrl: (url: string | null) => rive.wasm.push(url),
  },
  useRive: (params: typeof rive.params) => {
    rive.params = params
    return {
      rive: rive.instance,
      RiveComponent: (props: object) => <canvas data-testid="rive" {...props} />,
    }
  },
  useStateMachineInput: (_rive: unknown, _machine: string, name: string) => (rive.inputs[name] ??= { value: 0, fire: vi.fn() }),
}))

const RIVE_BYTES = new TextEncoder().encode('RIVE....').buffer

function serve(response: Response | Error) {
  vi.stubGlobal('fetch', vi.fn(async () => (response instanceof Error ? Promise.reject(response) : response.clone())))
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }))
}

beforeEach(() => {
  resetRiveFileForTest()
  rive.inputs = {}
  rive.params = null
  rive.instance.play.mockClear()
  rive.instance.pause.mockClear()
  setReducedMotion(false)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('RiveAvatar fallback', () => {
  it.each<[string, Response | Error]>([
    ['file missing', new Response(null, { status: 404 })],
    ['not a Rive file (e.g. an HTML page)', new Response('<!doctype html>', { status: 200 })],
    ['network error', new Error('offline')],
  ])('shows the placeholder image when %s', async (_label, response) => {
    serve(response)
    const { container } = render(<RiveAvatar mood="welcome" size={96} />)
    await act(async () => {})
    const img = container.querySelector('img')!
    expect(img).toHaveAttribute('src', '/avatar/placeholder.png')
    expect(img).toHaveAttribute('aria-hidden', 'true')
    expect(img).toHaveAttribute('width', '96')
    expect(img).toHaveAttribute('data-mood', 'welcome')
    expect(screen.queryByTestId('rive')).toBeNull()
  })

  it('shows the character when the file exists, and the placeholder if it fails to load', async () => {
    serve(new Response(RIVE_BYTES))
    const { container } = render(<RiveAvatar mood="attentive" />)
    expect(await screen.findByTestId('rive')).toHaveAttribute('aria-hidden', 'true')
    expect(rive.params?.buffer?.byteLength).toBe(RIVE_BYTES.byteLength)
    act(() => rive.params!.onLoadError!())
    expect(container.querySelector('img')).toHaveAttribute('src', '/avatar/placeholder.png')
  })

  it('serves the runtime from our own origin, never a CDN', () => {
    expect(rive.wasm).toHaveLength(2)
    for (const url of rive.wasm) {
      expect(url).not.toMatch(/^https?:/)
      expect(url).toMatch(/rive(_fallback)?\.wasm/)
    }
  })
})

describe('RiveCanvas', () => {
  const file = new ArrayBuffer(8)
  const props = { file, nod: false, size: 120, onError: () => {} }

  it('sets the emotion from the app mood', () => {
    const { rerender } = render(<RiveCanvas {...props} mood="thinking" recording={false} />)
    expect(rive.inputs.emotion.value).toBe(EMOTION.thinking)
    rerender(<RiveCanvas {...props} mood="concern" recording={false} />)
    expect(rive.inputs.emotion.value).toBe(5)
  })

  it('pauses shortly after recording starts and plays again afterwards', () => {
    vi.useFakeTimers()
    const { rerender } = render(<RiveCanvas {...props} mood="still" recording />)
    expect(rive.inputs.recording.value).toBe(true)
    act(() => vi.advanceTimersByTime(PAUSE_AFTER_MS - 1))
    expect(rive.instance.pause).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(rive.instance.pause).toHaveBeenCalledTimes(1)

    rerender(<RiveCanvas {...props} mood="attentive" recording={false} />)
    expect(rive.inputs.recording.value).toBe(false)
    expect(rive.instance.play).toHaveBeenCalled()
  })

  it('fires `noted` once per nod and pauses again while recording', () => {
    vi.useFakeTimers()
    const { rerender } = render(<RiveCanvas {...props} mood="still" recording />)
    act(() => vi.advanceTimersByTime(PAUSE_AFTER_MS))
    rerender(<RiveCanvas {...props} nod mood="still" recording />)
    rerender(<RiveCanvas {...props} nod mood="still" recording />)
    expect(rive.inputs.noted.fire).toHaveBeenCalledTimes(1)
    expect(rive.instance.play).toHaveBeenCalledTimes(1)
    rerender(<RiveCanvas {...props} mood="still" recording />) // nod ends after 1 s
    act(() => vi.advanceTimersByTime(1000 + PAUSE_AFTER_MS))
    expect(rive.instance.pause).toHaveBeenCalledTimes(2)
  })

  it('follows the pointer, but not while recording or with reduced motion', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    const move = () => {
      fireEvent.pointerMove(window, { clientX: window.innerWidth, clientY: 0 })
      act(() => vi.advanceTimersToNextFrame())
    }
    const { rerender } = render(<RiveCanvas {...props} mood="attentive" recording={false} />)
    move()
    expect(rive.inputs.lookX.value).toBe(100)
    expect(rive.inputs.lookY.value).toBe(-100)

    rive.inputs.lookX.value = 0
    rerender(<RiveCanvas {...props} mood="still" recording />)
    move()
    expect(rive.inputs.lookX.value).toBe(0)

    setReducedMotion(true)
    rerender(<RiveCanvas {...props} mood="attentive" recording={false} />)
    move()
    expect(rive.inputs.lookX.value).toBe(0)
  })
})
