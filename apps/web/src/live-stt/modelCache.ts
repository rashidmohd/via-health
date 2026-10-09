import { useSyncExternalStore } from 'react'
import { LIVE_STT_LANGUAGES, LIVE_STT_VERSION, type LiveSttLanguage } from './version'

/**
 * Downloads the live transcript engine and models into Cache Storage when the app opens
 * (ADR 0014), so the live preview starts within seconds when a recording starts. The worker
 * (`public/live-stt-worker.js`) reads the same cache entries and falls back to the network.
 *
 * Cache Storage, not the HTTP cache: Firefox does not keep single responses above 50 MB there.
 * Only our own static files are stored; nothing from a session.
 */

const CACHE_PREFIX = 'sessio-live-stt-'
/** Must match the cache name the worker builds from its `v` parameter. */
export const MODEL_CACHE = `${CACHE_PREFIX}${LIVE_STT_VERSION}`
/** Recordings share the origin's storage quota: keep this much free for audio. */
const RECORDING_HEADROOM_BYTES = 500 * 1024 * 1024

const base = `/live-stt/${LIVE_STT_VERSION}/`
export const ENGINE_URL = `${base}sherpa-onnx-wasm-main-asr.wasm`
export const modelUrl = (language: LiveSttLanguage) => `${base}${language}/sherpa-onnx-wasm-main-asr.data`

export type PreloadState =
  | { status: 'idle' | 'ready' | 'skipped' | 'error' }
  | { status: 'loading'; progress: number }

let state: PreloadState = { status: 'idle' }
let running: Promise<void> | null = null
const listeners = new Set<() => void>()

function setState(next: PreloadState): void {
  state = next
  listeners.forEach((listener) => listener())
}

export function usePreloadState(): PreloadState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

export function preloadSupported(): boolean {
  return typeof caches !== 'undefined' && typeof fetch !== 'undefined'
}

/** Starts the download once per page load. Languages are fetched in the given order. */
export function preloadLiveModels(first?: string): Promise<void> {
  if (running) return running
  const languages = [...LIVE_STT_LANGUAGES].sort((a, b) => Number(b === first) - Number(a === first))
  running = run(languages).catch(() => setState({ status: 'error' }))
  return running
}

/** For tests only. */
export function resetPreload(): void {
  running = null
  state = { status: 'idle' }
}

async function run(languages: LiveSttLanguage[]): Promise<void> {
  if (!preloadSupported() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    setState({ status: 'skipped' })
    return
  }
  const cache = await caches.open(MODEL_CACHE)
  void removeOldVersions()

  const wanted = [ENGINE_URL, ...languages.map(modelUrl)]
  const missing: string[] = []
  for (const url of wanted) if (!(await cache.match(url))) missing.push(url)
  if (missing.length === 0) {
    setState({ status: 'ready' })
    return
  }

  const sizes = await expectedSizes()
  const total = missing.reduce((sum, url) => sum + (sizes.get(url) ?? 0), 0)
  if (!(await enoughSpace(total))) {
    setState({ status: 'skipped' })
    return
  }

  let done = 0
  setState({ status: 'loading', progress: 0 })
  for (const url of missing) {
    const response = await fetch(url)
    if (!response.ok || !response.body) throw new Error('model_download_failed')
    const reader = response.body.getReader()
    const counted = sizes.has(url) // progress counts only files with a known size
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done: finished, value } = await reader.read()
      if (finished) break
      chunks.push(value)
      if (!counted) continue
      done += value.byteLength
      if (total > 0) setState({ status: 'loading', progress: Math.min(done / total, 1) })
    }
    const type = response.headers.get('Content-Type') ?? 'application/octet-stream'
    await cache.put(url, new Response(new Blob(chunks as BlobPart[], { type }), { headers: { 'Content-Type': type } }))
  }
  setState({ status: 'ready' })
}

/** Sizes from the model manifest; the engine size is known only from the response. */
async function expectedSizes(): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  try {
    const manifest = (await (await fetch(`${base}manifest.json`)).json()) as {
      languages: Record<string, { bytes: number }>
    }
    for (const language of LIVE_STT_LANGUAGES) {
      const bytes = manifest.languages[language]?.bytes
      if (bytes) sizes.set(modelUrl(language), bytes)
    }
  } catch {
    // No manifest: progress is shown as soon as the downloads report sizes.
  }
  return sizes
}

async function enoughSpace(bytes: number): Promise<boolean> {
  try {
    const { quota, usage } = await navigator.storage.estimate()
    if (quota === undefined || usage === undefined) return true
    return quota - usage > bytes + RECORDING_HEADROOM_BYTES
  } catch {
    return true
  }
}

async function removeOldVersions(): Promise<void> {
  try {
    const names = await caches.keys()
    await Promise.all(
      names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== MODEL_CACHE).map((name) => caches.delete(name)),
    )
  } catch {
    // Old versions stay until the next visit.
  }
}
