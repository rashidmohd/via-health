import { fireEvent, screen } from '@testing-library/react'
import i18n from './i18n'
import { ME, mockApi, renderApp } from './test-utils'

describe('App shell (logged in)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mockApi(() => ({ status: 200, body: ME }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows all seven nav items in order', async () => {
    renderApp()
    await screen.findByText('Anna')
    const links = screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('a')
    expect([...links].map((a) => a.textContent)).toEqual([
      'Today',
      'Notifications',
      'Clients',
      'Sessions',
      'Reports',
      'Keys',
      'Settings',
    ])
  })

  it('marks the current route as active and navigates', async () => {
    renderApp()
    expect(await screen.findByRole('link', { name: 'Today' })).toHaveClass('active')
    fireEvent.click(screen.getByRole('link', { name: 'Reports' }))
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument()
  })

  it('renders German labels', async () => {
    await i18n.changeLanguage('de')
    renderApp('/clients')
    expect(await screen.findByRole('heading', { name: 'Klient:innen' })).toBeInTheDocument()
  })
})
