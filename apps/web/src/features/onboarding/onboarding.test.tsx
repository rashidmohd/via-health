import { fireEvent, screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n'
import { ME, mockApi, renderApp } from '../../test-utils'

function server(hasKeys: boolean) {
  mockApi((url) => {
    if (url.endsWith('/auth/me')) return { status: 200, body: { ...ME, has_keys: hasKeys } }
    if (url.includes('/notifications')) return { status: 200, body: { items: [], unread: 0 } }
    return { status: 200, body: [] }
  })
}

beforeEach(async () => {
  localStorage.clear()
  await i18n.changeLanguage('en')
})

describe('welcome', () => {
  it('greets a new account once, then goes to Today', async () => {
    server(false)
    const { unmount } = renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Welcome to Sessio, Anna' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(await screen.findByRole('heading', { name: /Anna/, level: 1 })).not.toHaveTextContent('Welcome')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    unmount()

    server(false)
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent('Welcome')
  })

  it('does not interrupt existing users', async () => {
    server(true)
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent('Welcome')
  })

  it('is in German too', async () => {
    await i18n.changeLanguage('de')
    server(false)
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Willkommen bei Sessio, Anna' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rundgang starten' })).toBeInTheDocument()
  })
})

describe('tour', () => {
  it('walks through the app from the welcome page and can be closed', async () => {
    server(false)
    renderApp('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Show me around' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Start a session')
    expect(dialog).toHaveTextContent('1 of 8')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Clients')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Start a session')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('can be started again from settings', async () => {
    server(true)
    renderApp('/settings')
    fireEvent.click(await screen.findByRole('button', { name: 'Start the tour' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Start a session')
  })
})
