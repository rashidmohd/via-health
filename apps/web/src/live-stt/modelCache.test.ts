import { ENGINE_URL, MODEL_CACHE, modelUrl, preloadLiveModels, resetPreload, usePreloadState } from './modelCache'
import { act, renderHook } from '@testing-library/react'

/** Minimal Cache Storage: one map per cache name. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      match: async (url: string) => store.get(url)?.clone(),
      put: async (url: string, response: Response) => void store.set(url, response),
    }
  }
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
  }
}

const SIZES = { de: 10, en: 10 }

function stubFetch(fail?: string) {
  const fetched: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url)
      if (url.endsWith('manifest.json')) {
        return new Response(JSON.stringify({ languages: { de: { bytes: SIZES.de }, en: { bytes: SIZES.en } } }))
      }
      if (url === fail) return new Response('', { status: 404 })
      return new Response(new Uint8Array(url.endsWith('.wasm') ? 4 : 10))
    }),
  )
  return fetched
}

describe('live model preload', () => {
  let caches: ReturnType<typeof fakeCaches>

  beforeEach(() => {
    resetPreload()
    caches = fakeCaches()
    vi.stubGlobal('caches', caches.api)
    vi.stubGlobal('navigator', { onLine: true, storage: { estimate: async () => ({ quota: 10e9, usage: 0 }) } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('downloads the engine and both models into the versioned cache, UI language first', async () => {
    const fetched = stubFetch()
    const { result } = renderHook(() => usePreloadState())
    await act(() => preloadLiveModels('en'))

    expect(fetched.filter((url) => !url.endsWith('manifest.json'))).toEqual([ENGINE_URL, modelUrl('en'), modelUrl('de')])
    expect([...caches.stores.get(MODEL_CACHE)!.keys()]).toEqual([ENGINE_URL, modelUrl('en'), modelUrl('de')])
    expect(result.current).toEqual({ status: 'ready' })
  })

  it('reports progress while loading', async () => {
    stubFetch()
    const seen: number[] = []
    const { result } = renderHook(() => {
      const state = usePreloadState()
      if (state.status === 'loading') seen.push(state.progress)
      return state
    })
    await act(() => preloadLiveModels('de'))
    expect(result.current.status).toBe('ready')
    expect(seen.at(-1)).toBe(1)
  })

  it('downloads nothing when everything is cached, and removes old versions', async () => {
    const current = await caches.api.open(MODEL_CACHE)
    for (const url of [ENGINE_URL, modelUrl('de'), modelUrl('en')]) await current.put(url, new Response('x'))
    await caches.api.open('sessio-live-stt-old')
    const fetched = stubFetch()

    await preloadLiveModels('de')
    expect(fetched).toEqual([])
    await vi.waitFor(() => expect([...caches.stores.keys()]).toEqual([MODEL_CACHE]))
  })

  it('runs only once per page load', async () => {
    const fetched = stubFetch()
    await Promise.all([preloadLiveModels('de'), preloadLiveModels('de')])
    expect(fetched.filter((url) => url === ENGINE_URL)).toHaveLength(1)
  })

  it('reports an error when a download fails', async () => {
    stubFetch(modelUrl('en'))
    const { result } = renderHook(() => usePreloadState())
    await act(() => preloadLiveModels('de'))
    expect(result.current.status).toBe('error')
  })

  it('skips when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fetched = stubFetch()
    const { result } = renderHook(() => usePreloadState())
    await act(() => preloadLiveModels('de'))
    expect(fetched).toEqual([])
    expect(result.current.status).toBe('skipped')
  })

  it('leaves the storage to recordings when space is short', async () => {
    vi.stubGlobal('navigator', { onLine: true, storage: { estimate: async () => ({ quota: 400e6, usage: 0 }) } })
    const fetched = stubFetch()
    const { result } = renderHook(() => usePreloadState())
    await act(() => preloadLiveModels('de'))
    expect(fetched.filter((url) => !url.endsWith('manifest.json'))).toEqual([])
    expect(result.current.status).toBe('skipped')
  })
})
