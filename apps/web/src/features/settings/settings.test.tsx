import { fireEvent, screen, waitFor } from '@testing-library/react'
import { reloadAvatarSettingsForTest } from '../../avatar/settings'
import i18n from '../../i18n'
import { ME, mockApi, renderApp } from '../../test-utils'

describe('settings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    localStorage.clear()
    reloadAvatarSettingsForTest()
    mockApi((url) => (url.endsWith('/auth/me') ? { status: 200, body: ME } : { status: 200, body: [] }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('defaults to the illustrated avatar with reactions off', async () => {
    renderApp('/settings')
    expect(await screen.findByRole('radio', { name: /Illustrated avatar/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Short glance/ })).not.toBeChecked()
  })

  it('switches the profile picture to initials everywhere', async () => {
    const { container, unmount } = renderApp('/settings')
    fireEvent.click(await screen.findByRole('radio', { name: /Initials/ }))
    expect(JSON.parse(localStorage.getItem('sessio.avatar')!)).toMatchObject({ kind: 'initials' })
    unmount()

    renderApp('/')
    await waitFor(() => expect(document.querySelector('.today .avatar-ring .initials')).toHaveTextContent('A'))
    expect(container.querySelector('.today .avatar-ring img')).toBeNull()
  })

  it('stores the reactions choice', async () => {
    renderApp('/settings')
    fireEvent.click(await screen.findByRole('checkbox', { name: /Short glance/ }))
    expect(JSON.parse(localStorage.getItem('sessio.avatar')!)).toMatchObject({ nodOnCapture: true })
  })
})
