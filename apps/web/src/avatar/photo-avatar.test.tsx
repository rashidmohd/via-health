import { act, fireEvent, render } from '@testing-library/react'
import { PhotoAvatar } from './PhotoAvatar'

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }))
}

describe('photo avatar', () => {
  beforeEach(() => {
    setReducedMotion(false)
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function moveToRightEdge() {
    fireEvent.pointerMove(window, { clientX: window.innerWidth, clientY: window.innerHeight / 2 })
    act(() => vi.advanceTimersToNextFrame())
  }

  it('is decorative', () => {
    const { container } = render(<PhotoAvatar src="data:image/webp;base64," size={56} />)
    expect(container.querySelector('img')).toHaveAttribute('aria-hidden', 'true')
  })

  it('tilts at most 4° toward the pointer when switched on', () => {
    const { container, rerender } = render(<PhotoAvatar src="data:," size={56} />)
    const img = container.querySelector('img')!
    moveToRightEdge()
    expect(img.style.transform).toBe('')

    rerender(<PhotoAvatar src="data:," size={56} tilt />)
    moveToRightEdge()
    expect(img.style.transform).toBe('perspective(600px) rotateY(4deg) rotateX(0deg)')
  })

  it('stays still while recording and with reduced motion', () => {
    const { container, rerender } = render(<PhotoAvatar src="data:," size={56} tilt />)
    const img = container.querySelector('img')!
    moveToRightEdge()
    rerender(<PhotoAvatar src="data:," size={56} tilt recording />)
    expect(img.style.transform).toBe('')
    moveToRightEdge()
    expect(img.style.transform).toBe('')

    setReducedMotion(true)
    rerender(<PhotoAvatar src="data:," size={56} tilt />)
    moveToRightEdge()
    expect(img.style.transform).toBe('')
  })
})
