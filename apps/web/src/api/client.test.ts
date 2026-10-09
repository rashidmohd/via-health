import { api, ApiError, REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from './client'

/** A connection that never answers (e.g. stalled after the laptop slept), until aborted. */
function stalledFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  )
}

describe('api timeouts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('gives up on a stalled request as a retryable network error', async () => {
    vi.stubGlobal('fetch', stalledFetch())
    const request = api('/sessions', { method: 'POST', body: {} })
    const outcome = expect(request).rejects.toEqual(new ApiError('network_error', 0))
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    await outcome
  })

  it('gives chunk uploads longer', async () => {
    vi.stubGlobal('fetch', stalledFetch())
    let settled = false
    const request = api('/sessions/s1/chunks/0', { method: 'PUT', bytes: new Uint8Array([1]) }).catch((error) => {
      settled = true
      throw error
    })
    const outcome = expect(request).rejects.toEqual(new ApiError('network_error', 0))
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - REQUEST_TIMEOUT_MS)
    await outcome
  })
})
