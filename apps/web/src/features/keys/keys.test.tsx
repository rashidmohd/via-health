import { fireEvent, screen, waitFor } from '@testing-library/react'
import { lock, unlockedKey } from '../../crypto/keyring'
import { PgpError } from '../../crypto/pgp'
import i18n from '../../i18n'
import { confirmInDialog, ME, mockApi, renderApp } from '../../test-utils'

// The real openpgp.js is covered in crypto/pgp.test.ts; here only the page flow.
const RECOVERY_FP = 'b'.repeat(56) + 'ab12cd34'
const UNLOCKED = { clearPrivateParams: vi.fn() }
vi.mock('../../crypto/pgp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../crypto/pgp')>()),
  createTherapistKey: vi.fn(async () => ({
    publicKey: 'therapist-public',
    privateKey: 'therapist-private-locked',
    fingerprint: 'a'.repeat(64),
  })),
  createRecoveryKey: vi.fn(async () => ({
    publicKey: 'recovery-public',
    privateKey: 'recovery-private-SECRET',
    fingerprint: RECOVERY_FP,
  })),
  unlockPrivateKey: vi.fn(async (_key: string, passphrase: string) => {
    const { PgpError: Err } = await import('../../crypto/pgp')
    if (passphrase !== 'olive tree quiet harbour') throw new Err('passphrase_wrong')
    return UNLOCKED
  }),
}))

const KEYS = {
  therapist_public_key: 'therapist-public',
  therapist_private_key: 'therapist-private-locked',
  recovery_public_key: 'recovery-public',
  therapist_fingerprint: 'a'.repeat(64),
  recovery_fingerprint: RECOVERY_FP,
}

let stored: typeof KEYS | null
let calls: ReturnType<typeof mockApi>

function server() {
  calls = mockApi((url, init) => {
    const method = init.method ?? 'GET'
    if (url.endsWith('/auth/me')) return { status: 200, body: { ...ME, has_keys: stored !== null } }
    if (url.endsWith('/keys/check-code-email')) return { status: 202, body: { status: 'sent' } }
    if (url.endsWith('/keys') && method === 'PUT') {
      stored = JSON.parse(init.body as string) as typeof KEYS
      return { status: 201, body: stored }
    }
    if (url.endsWith('/keys')) return stored ? { status: 200, body: stored } : { status: 404, body: { code: 'keys_missing' } }
    return { status: 200, body: [] }
  })
}

beforeEach(async () => {
  stored = null
  localStorage.setItem(`sessio.welcomeSeen.${ME.id}`, '1') // welcome page covered in onboarding.test
  lock()
  await i18n.changeLanguage('en')
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recovery')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  server()
})

async function createKeys(passphrase = 'olive tree quiet harbour', repeat = passphrase) {
  renderApp('/keys')
  fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: passphrase } })
  fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: repeat } })
  fireEvent.click(screen.getByRole('button', { name: 'Create keys' }))
}

describe('key setup', () => {
  it('checks the passphrase before creating keys', async () => {
    await createKeys('short', 'short')
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 12 characters')
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'olive tree quiet harbour' } })
    fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: 'olive tree quiet harbor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create keys' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not the same')
  })

  it('cannot finish without the check code from the downloaded recovery file', async () => {
    await createKeys()
    expect(await screen.findByRole('heading', { name: 'Save your recovery key' })).toBeInTheDocument()
    // The check field appears only after the download.
    expect(screen.queryByLabelText('Check code from the file')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Download recovery key' }))
    expect(URL.createObjectURL).toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Check code from the file'), { target: { value: 'AB12-CD35' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match')
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('stores public keys and the locked private key, never the recovery private key', async () => {
    await createKeys()
    fireEvent.click(await screen.findByRole('button', { name: 'Download recovery key' }))
    fireEvent.change(screen.getByLabelText('Check code from the file'), { target: { value: 'ab12 cd34' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))

    expect(await screen.findByRole('heading', { name: 'Key details' })).toBeInTheDocument()
    const put = calls.find((call) => call.method === 'PUT')
    expect(put?.body).toEqual(KEYS)
    expect(JSON.stringify(put?.body)).not.toContain('SECRET')
    expect(screen.getByText('Unlocked')).toBeInTheDocument()
    expect(unlockedKey()).toBe(UNLOCKED)
  })

  it('emails the check code only after the therapist agrees (ADR 0017)', async () => {
    await createKeys()
    fireEvent.click(await screen.findByRole('button', { name: 'Download recovery key' }))
    const emailLink = screen.getByRole('button', { name: /Send it to me by email/ })

    fireEvent.click(emailLink)
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('anna@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(calls.some((call) => call.url.endsWith('/check-code-email'))).toBe(false)

    fireEvent.click(emailLink)
    await confirmInDialog('Send code')
    expect(await screen.findByRole('status')).toHaveTextContent('Check code sent to anna@example.com')
    const sent = calls.find((call) => call.url.endsWith('/check-code-email'))
    expect(sent?.body).toEqual({ check_code: 'AB12-CD34', consent: true })
    expect(JSON.stringify(calls)).not.toContain('SECRET')
  })

  it('is in German too', async () => {
    await i18n.changeLanguage('de')
    renderApp('/keys')
    expect(await screen.findByRole('heading', { name: 'Schlüssel einrichten' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schlüssel erstellen' })).toBeInTheDocument()
  })
})

describe('keys set up', () => {
  beforeEach(() => {
    stored = KEYS
  })

  it('unlocks with the passphrase and locks again', async () => {
    renderApp('/keys')
    expect(await screen.findByText('Locked')).toBeInTheDocument()
    expect(screen.getByText(/AAAA AAAA/)).toBeInTheDocument()
    expect(screen.getByText(/check code AB12-CD34/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'wrong passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The passphrase is not correct.')
    expect(unlockedKey()).toBeNull()

    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'olive tree quiet harbour' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByText('Unlocked')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lock now' }))
    await waitFor(() => expect(screen.getByText('Locked')).toBeInTheDocument())
    expect(unlockedKey()).toBeNull()
    expect(UNLOCKED.clearPrivateParams).toHaveBeenCalled()
  })

  it('uses the device copy when offline', async () => {
    const online = renderApp('/keys')
    expect(await screen.findByText('Locked')).toBeInTheDocument() // saved to the device on first load
    online.unmount()
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).endsWith('/auth/me')) return new Response(JSON.stringify({ ...ME, has_keys: true }), { status: 200 })
      throw new TypeError('offline')
    })
    renderApp('/keys')
    expect(await screen.findByText('Locked')).toBeInTheDocument()
    expect(screen.getByText(/AAAA AAAA/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

it('PgpError keeps a code only', () => {
  expect(new PgpError('passphrase_wrong').message).toBe('passphrase_wrong')
})

describe('setup card on Today', () => {
  it('asks a user without keys to set them up', async () => {
    server()
    renderApp('/')
    expect(await screen.findByText('Your keys are not set up yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up keys' })).toHaveAttribute('href', '/keys')
  })

  it('asks for the first client once keys exist', async () => {
    stored = KEYS
    server() // /clients answers []
    renderApp('/')
    expect(await screen.findByText('Add your first client')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add client' })).toHaveAttribute('href', '/clients/new')
    expect(screen.queryByText('Your keys are not set up yet')).not.toBeInTheDocument()
  })

  it('is gone when keys and a client exist', async () => {
    stored = KEYS
    calls = mockApi((url) => {
      if (url.endsWith('/auth/me')) return { status: 200, body: { ...ME, has_keys: true } }
      if (url.endsWith('/clients')) return { status: 200, body: [{ id: 'c1', name: 'Mia' }] }
      return { status: 200, body: [] }
    })
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/clients'))).toBe(true))
    expect(screen.queryByText('Add your first client')).not.toBeInTheDocument()
    expect(screen.queryByText('Your keys are not set up yet')).not.toBeInTheDocument()
  })
})
