import { act, fireEvent, render, screen } from '@testing-library/react'
import i18n from '../../i18n'
import { micTested } from '../../recorder/micDevice'
import { setVoiceStateForTest, stopVoiceMonitor } from '../../recorder/micMonitor'
import { MicHealth, MicTest } from './MicHealth'
import { MIC_TEST_MS, SILENCE_WARNING_MS, silenceTooLong } from './micRules'

const monitor = vi.hoisted(() => ({
  supported: true,
  onVoice: null as null | ((active: boolean) => void),
  stops: 0,
}))

vi.mock('../../recorder/micMonitor', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../recorder/micMonitor')>()
  return {
    ...real,
    micMonitorSupported: () => monitor.supported,
    MicMonitor: {
      start: async (_stream: MediaStream, options: { onVoice: (active: boolean) => void }) => {
        monitor.onVoice = options.onVoice
        return { stop: () => monitor.stops++ }
      },
    },
  }
})

const track = { stop: vi.fn() }

beforeEach(async () => {
  await i18n.changeLanguage('en')
  localStorage.clear()
  monitor.supported = true
  monitor.onVoice = null
  monitor.stops = 0
  track.stop.mockClear()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })),
      enumerateDevices: vi.fn(async () => [
        { kind: 'audioinput', deviceId: 'usb', label: 'USB microphone' },
        { kind: 'videoinput', deviceId: 'cam', label: 'Camera' },
      ]),
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  stopVoiceMonitor()
})

describe('silence warning', () => {
  const base = { status: 'on' as const, active: false, lastVoiceAt: 0 }

  it.each<[string, Partial<typeof base> & { now: number }, boolean]>([
    ['just under 2 minutes', { now: SILENCE_WARNING_MS - 1 }, false],
    ['2 minutes of silence', { now: SILENCE_WARNING_MS }, true],
    ['someone is speaking', { now: SILENCE_WARNING_MS * 5, active: true }, false],
    ['cannot measure: never guess', { now: SILENCE_WARNING_MS * 5, status: 'unavailable' as never }, false],
  ])('%s', (_label, { now, ...state }, warn) => {
    expect(silenceTooLong({ ...base, ...state }, now)).toBe(warn)
  })

  it('shows voice state and warns after 2 minutes without speech', () => {
    vi.useFakeTimers()
    act(() => setVoiceStateForTest({ status: 'on', active: true, lastVoiceAt: Date.now() }))
    render(<MicHealth />)
    expect(screen.getByText('Voice detected')).toBeInTheDocument()

    act(() => setVoiceStateForTest({ active: false, lastVoiceAt: Date.now() }))
    expect(screen.getByText('No voice')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(SILENCE_WARNING_MS - 10_000))
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByRole('alert')).toHaveTextContent('No speech picked up for 2 minutes')
    expect(screen.getByLabelText('Microphone for the next recording')).toBeInTheDocument()

    act(() => setVoiceStateForTest({ active: true, lastVoiceAt: Date.now() }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says so when the browser cannot measure', () => {
    act(() => setVoiceStateForTest({ status: 'unavailable' }))
    render(<MicHealth />)
    expect(screen.getByText(/not available in this browser/)).toBeInTheDocument()
  })
})

describe('first-time mic test', () => {
  it('passes once a voice is picked up and remembers it', async () => {
    const passed = vi.fn()
    render(<MicTest onPassed={passed} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Test microphone' })))
    expect(screen.getByText('Say a few words now.')).toBeInTheDocument()
    act(() => monitor.onVoice!(true))
    expect(passed).toHaveBeenCalled()
    expect(micTested()).toBe(true)
    expect(track.stop).toHaveBeenCalled()
    expect(monitor.stops).toBe(1)
  })

  it('fails after 5 seconds without voice and offers the microphone choice', async () => {
    vi.useFakeTimers()
    const passed = vi.fn()
    render(<MicTest onPassed={passed} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Test microphone' })))
    act(() => vi.advanceTimersByTime(MIC_TEST_MS))
    expect(screen.getByRole('alert')).toHaveTextContent('No speech picked up')
    expect(passed).not.toHaveBeenCalled()
    expect(micTested()).toBe(false)
    expect(track.stop).toHaveBeenCalled()
    await act(async () => {})
    fireEvent.change(screen.getByLabelText('Microphone for the next recording'), { target: { value: 'usb' } })
    expect(localStorage.getItem('sessio.micDevice')).toBe('usb')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('does not block recording when the browser cannot measure', () => {
    monitor.supported = false
    const passed = vi.fn()
    render(<MicTest onPassed={passed} />)
    expect(passed).toHaveBeenCalled()
  })
})
