import { IDLE_LOCK_MS, lock, setUnlocked, unlockedKey } from './keyring'
import type { UnlockedKey } from './pgp'

function fakeKey() {
  return { clearPrivateParams: vi.fn() } as unknown as UnlockedKey & { clearPrivateParams: ReturnType<typeof vi.fn> }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  lock()
  vi.useRealTimers()
})

describe('keyring', () => {
  it('locks after 15 minutes without activity and clears the key', () => {
    const key = fakeKey()
    setUnlocked(key)
    vi.advanceTimersByTime(IDLE_LOCK_MS - 1000)
    expect(unlockedKey()).toBe(key)
    vi.advanceTimersByTime(IDLE_LOCK_MS)
    expect(unlockedKey()).toBeNull()
    expect(key.clearPrivateParams).toHaveBeenCalled()
  })

  it('activity keeps it unlocked', () => {
    setUnlocked(fakeKey())
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(IDLE_LOCK_MS - 1000)
      window.dispatchEvent(new Event('keydown'))
    }
    expect(unlockedKey()).not.toBeNull()
  })

  it('locks when the page is hidden for good', () => {
    const key = fakeKey()
    setUnlocked(key)
    window.dispatchEvent(new Event('pagehide'))
    expect(unlockedKey()).toBeNull()
    expect(key.clearPrivateParams).toHaveBeenCalled()
  })

  it('lock now', () => {
    setUnlocked(fakeKey())
    lock()
    expect(unlockedKey()).toBeNull()
  })
})
