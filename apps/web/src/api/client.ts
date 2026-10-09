export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

/** Error from the API. `code` is a stable code translated via `errors.*` (de/en). */
export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number) {
    super(code)
    this.code = code
    this.status = status
  }
}

export interface ApiInit {
  method?: string
  /** JSON body. */
  body?: unknown
  /** Binary body (sent as-is), e.g. an encrypted audio chunk. */
  bytes?: Uint8Array
  headers?: Record<string, string>
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...init.headers }
  let body: BodyInit | undefined
  if (init.bytes !== undefined) {
    headers['Content-Type'] ??= 'application/octet-stream'
    body = init.bytes as Uint8Array<ArrayBuffer>
  } else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      headers,
      body,
    })
  } catch {
    throw new ApiError('network_error', 0)
  }
  if (response.status === 204) return undefined as T
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const code =
      data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
        ? data.code
        : 'unknown'
    throw new ApiError(code, response.status)
  }
  return data as T
}
