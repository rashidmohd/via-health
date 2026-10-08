import { fireEvent, screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n'
import { ME, mockApi, renderApp } from '../../test-utils'

async function type(label: string, value: string) {
  fireEvent.change(await screen.findByLabelText(label), { target: { value } })
}

describe('login and signup', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('redirects to sign-in when not logged in', async () => {
    mockApi(() => ({ status: 401, body: { code: 'not_authenticated' } }))
    renderApp('/reports')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('signs in with an email code', async () => {
    let loggedIn = false
    const calls = mockApi((url) => {
      if (url.endsWith('/auth/me')) {
        return loggedIn ? { status: 200, body: ME } : { status: 401, body: { code: 'not_authenticated' } }
      }
      if (url.endsWith('/auth/email/start')) return { status: 202, body: { status: 'sent' } }
      if (url.endsWith('/auth/email/verify')) {
        loggedIn = true
        return { status: 200, body: ME }
      }
      return { status: 404 }
    })
    renderApp('/login')
    await type('Email address', 'anna@example.com')
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }))
    expect(await screen.findByText(/We sent a code to anna@example.com/)).toBeInTheDocument()

    await type('6-digit code', '12a3456')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Anna')).toBeInTheDocument()
    const verify = calls.find((c) => c.url.endsWith('/auth/email/verify'))
    expect(verify?.body).toMatchObject({ email: 'anna@example.com', code: '123456', language: 'en' })
  })

  it('signs up with name and email', async () => {
    const calls = mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 401, body: { code: 'not_authenticated' } }
      if (url.endsWith('/auth/email/start')) return { status: 202, body: { status: 'sent' } }
      return { status: 200, body: { ...ME, display_name: 'Anna Weber' } }
    })
    renderApp('/signup')
    await type('Your name', 'Anna Weber')
    await type('Email address', 'anna@example.com')
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }))
    await type('6-digit code', '123456')
    fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Anna Weber')).toBeInTheDocument()
    const verify = calls.find((c) => c.url.endsWith('/auth/email/verify'))
    expect(verify?.body).toMatchObject({ display_name: 'Anna Weber' })
  })

  it('shows a translated error for a wrong code', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 401, body: { code: 'not_authenticated' } }
      if (url.endsWith('/auth/email/start')) return { status: 202, body: { status: 'sent' } }
      return { status: 400, body: { code: 'code_invalid' } }
    })
    await i18n.changeLanguage('de')
    renderApp('/login')
    await type('E-Mail-Adresse', 'anna@example.com')
    fireEvent.click(await screen.findByRole('button', { name: 'Code senden' }))
    await type('6-stelliger Code', '000000')
    fireEvent.click(await screen.findByRole('button', { name: 'Anmelden' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Dieser Code ist nicht gültig')
  })

  it('asks for a name when the account has none', async () => {
    mockApi((url, init) => {
      if (url.endsWith('/auth/me') && init.method === 'PATCH') {
        return { status: 200, body: { ...ME, display_name: 'Ben' } }
      }
      return { status: 200, body: { ...ME, display_name: '' } }
    })
    renderApp()
    await type('Your name', 'Ben')
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Ben')).toBeInTheDocument()
  })

  it('signs out', async () => {
    let loggedIn = true
    mockApi((url) => {
      if (url.endsWith('/auth/logout')) {
        loggedIn = false
        return { status: 204 }
      }
      return loggedIn ? { status: 200, body: ME } : { status: 401, body: { code: 'not_authenticated' } }
    })
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument())
  })
})
