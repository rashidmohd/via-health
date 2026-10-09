import { render } from '@testing-library/react'
import { AvatarRing } from './AvatarRing'
import { ringState } from './ring'

describe('avatar ring', () => {
  it.each<[string, Parameters<typeof ringState>[0], string]>([
    ['not recording', { recording: false, voiceActive: false }, 'idle'],
    ['voice outside a recording is ignored', { recording: false, voiceActive: true }, 'idle'],
    ['recording, nobody speaking', { recording: true, voiceActive: false }, 'silent'],
    ['recording, voice', { recording: true, voiceActive: true }, 'listening'],
    ['processing', { recording: false, voiceActive: false, processing: true }, 'processing'],
    ['recording wins over processing', { recording: true, voiceActive: false, processing: true }, 'silent'],
  ])('%s', (_label, input, state) => {
    expect(ringState(input)).toBe(state)
  })

  it('wraps any avatar and shows the state as a class', () => {
    const { container } = render(
      <AvatarRing state="listening">
        <span data-testid="face" />
      </AvatarRing>,
    )
    const ring = container.querySelector('.avatar-ring')!
    expect(ring).toHaveClass('is-listening')
    expect(ring.querySelector('[data-testid="face"]')).not.toBeNull()
    expect(ring.querySelector('.ring-badge')).toBeNull()
  })

  it('shows a decorative badge', () => {
    const { container } = render(
      <AvatarRing state="idle" badge="offline">
        <span />
      </AvatarRing>,
    )
    const badge = container.querySelector('.ring-badge')!
    expect(badge).toHaveAttribute('aria-hidden', 'true')
    expect(badge).toHaveAttribute('data-badge', 'offline')
  })
})
