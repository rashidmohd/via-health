import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import i18n from './i18n'

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App shell', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows all six nav items in order', () => {
    renderApp()
    const links = screen.getAllByRole('link').map((a) => a.textContent)
    expect(links).toEqual(['Today', 'Clients', 'Sessions', 'Reports', 'Keys', 'Settings'])
  })

  it('marks the current route as active and navigates', () => {
    renderApp()
    expect(screen.getByRole('link', { name: 'Today' })).toHaveClass('active')
    fireEvent.click(screen.getByRole('link', { name: 'Reports' }))
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument()
  })

  it('renders German labels', async () => {
    await i18n.changeLanguage('de')
    renderApp('/clients')
    expect(screen.getByRole('heading', { name: 'Klient:innen' })).toBeInTheDocument()
  })
})
