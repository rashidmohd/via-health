import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown }

/** Replace fetch with a fake API. Returns the list of calls made. */
export function mockApi(handler: Handler) {
  const calls: { url: string; method: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, method: init.method ?? 'GET', body })
      const result = handler(url, init)
      return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
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
