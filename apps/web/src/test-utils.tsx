import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown }

/** Replace fetch with a fake API. Returns the list of calls made. */
export function mockApi(handler: Handler) {
  const calls: { url: string; method: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
      calls.push({ url, method: init.method ?? 'GET', body })
      const result = handler(url, init)
      const noBody = result.body === undefined || result.status === 204
      return new Response(noBody ? null : JSON.stringify(result.body), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return calls
}

export function renderApp(path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

export const ME = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'anna@example.com',
  display_name: 'Anna',
  ui_language: 'en',
} as const

/** Therapist keys as the server returns them (plan 0014). Not real keys: tests that need
 *  OpenPGP mock crypto/pgp; the real library is covered in crypto/*.test.ts. */
export const TEST_KEYS = {
  therapist_public_key: 'therapist-public',
  therapist_private_key: 'therapist-private-locked',
  recovery_public_key: 'recovery-public',
  therapist_fingerprint: 'a'.repeat(64),
  recovery_fingerprint: 'b'.repeat(64),
}

/** Answer the in-app confirm dialog (design/ConfirmDialog.tsx) with its action button. */
export async function confirmInDialog(action: string) {
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: action }))
}
