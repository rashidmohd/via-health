/*
 * Live preview speech recognition (plan 0007 part 2, live-transcript-preview skill).
 * Classic worker: loads the sherpa-onnx WebAssembly engine and the model for one language from
 * our own origin (`?base=/live-stt/<version>/&lang=de|en`). Audio arrives on a MessagePort straight from the
 * AudioWorklet. Text goes only to the page that started this worker — nothing leaves the device.
 */
'use strict'

const params = new URL(self.location.href).searchParams
const base = params.get('base') || '/live-stt/'
const lang = params.get('lang') === 'en' ? 'en' : 'de'
const TOO_SLOW_RTF = 0.8 // decode time / audio time
const RTF_WINDOW_MS = 30000
const MAX_PENDING_MS = 60000 // audio kept while the model loads; older audio is dropped

let recognizer = null
let stream = null
let offsetMs = 0
let audioMs = 0 // audio received (ms since this preview started)
let utteranceStartMs = 0
let lastPartial = ''
let decodeMs = 0
let measuredAudioMs = 0
let stopped = false
let pending = [] // audio received before the model was ready
let pendingMs = 0

function post(message) {
  self.postMessage(message)
}

self.Module = {
  // Shared engine (.wasm) in the version folder, model package (.data) per language.
  locateFile: (path) => (path.endsWith('.data') ? `${base}${lang}/${path}` : base + path),
  print: () => {},
  printErr: () => {},
  setStatus: (status) => {
    const match = /Downloading data\.\.\. \((\d+)\/(\d+)\)/.exec(status || '')
    if (match) post({ type: 'loading', loaded: Number(match[1]), total: Number(match[2]) })
  },
  onAbort: () => post({ type: 'error', code: 'engine_failed' }),
  onRuntimeInitialized: () => {
    try {
      recognizer = createOnlineRecognizer(self.Module, {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: { encoder: './encoder.onnx', decoder: './decoder.onnx', joiner: './joiner.onnx' },
          paraformer: { encoder: '', decoder: '' },
          zipformer2Ctc: { model: '' },
          nemoCtc: { model: '' },
          toneCtc: { model: '' },
          tokens: './tokens.txt',
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
          modelType: '',
          modelingUnit: 'cjkchar',
          bpeVocab: '',
        },
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
        enableEndpoint: 1,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: 1.2,
        rule3MinUtteranceLength: 20,
        hotwordsFile: '',
        hotwordsScore: 1.5,
        ctcFstDecoderConfig: { graph: '', maxActive: 3000 },
        ruleFsts: '',
        ruleFars: '',
      })
      stream = recognizer.createStream()
      post({ type: 'ready' })
      const queued = pending
      pending = []
      pendingMs = 0
      queued.forEach(process)
    } catch {
      post({ type: 'error', code: 'engine_failed' })
    }
  },
}

function finishUtterance() {
  const text = recognizer.getResult(stream).text.trim()
  if (text) {
    post({ type: 'final', text, startMs: offsetMs + utteranceStartMs, endMs: offsetMs + audioMs })
  }
  recognizer.reset(stream)
  utteranceStartMs = audioMs
  lastPartial = ''
}

function onAudio(event) {
  if (stopped) return
  if (!recognizer) {
    // Model still loading: keep the start of the session so its first words are not lost.
    const { samples, sampleRate } = event.data
    pending.push(event.data)
    pendingMs += (samples.length / sampleRate) * 1000
    while (pendingMs > MAX_PENDING_MS && pending.length > 1) {
      const dropped = pending.shift()
      pendingMs -= (dropped.samples.length / dropped.sampleRate) * 1000
      audioMs += (dropped.samples.length / dropped.sampleRate) * 1000
      utteranceStartMs = audioMs
    }
    return
  }
  process(event.data)
}

function process({ samples, sampleRate }) {
  const started = performance.now()
  stream.acceptWaveform(sampleRate, samples)
  while (recognizer.isReady(stream)) recognizer.decode(stream)
  const chunkMs = (samples.length / sampleRate) * 1000
  audioMs += chunkMs

  if (recognizer.isEndpoint(stream)) {
    finishUtterance()
  } else {
    const partial = recognizer.getResult(stream).text.trim()
    if (partial !== lastPartial) {
      lastPartial = partial
      post({ type: 'partial', text: partial, startMs: offsetMs + utteranceStartMs })
    }
  }

  // Too slow for this device: stop rather than fall behind (recording is unaffected).
  decodeMs += performance.now() - started
  measuredAudioMs += chunkMs
  if (measuredAudioMs >= RTF_WINDOW_MS) {
    const rtf = decodeMs / measuredAudioMs
    decodeMs = 0
    measuredAudioMs = 0
    if (rtf > TOO_SLOW_RTF) {
      stopped = true
      post({ type: 'too_slow', rtf })
    }
  }
}

self.onmessage = (event) => {
  const message = event.data
  if (message.type === 'start') {
    offsetMs = message.offsetMs || 0
    message.port.onmessage = onAudio
  } else if (message.type === 'stop') {
    if (recognizer && !stopped) finishUtterance()
    stopped = true
    post({ type: 'stopped' })
  }
}

/*
 * Engine and model downloaded in advance by the page (src/live-stt/modelCache.ts, ADR 0014):
 * hand them to the loader so nothing is fetched again. Missing or unreadable → network.
 * The cache name must match MODEL_CACHE there.
 */
async function loadCachedFiles() {
  const version = params.get('v')
  if (!version || typeof caches === 'undefined') return
  try {
    const cache = await caches.open('sessio-live-stt-' + version)
    const [engine, model] = await Promise.all([
      cache.match(base + 'sherpa-onnx-wasm-main-asr.wasm'),
      cache.match(`${base}${lang}/sherpa-onnx-wasm-main-asr.data`),
    ])
    if (engine) self.Module.wasmBinary = await engine.arrayBuffer()
    if (model) {
      const data = await model.arrayBuffer()
      self.Module.getPreloadedPackage = () => data
    }
  } catch {
    // Fall back to the network.
  }
}

loadCachedFiles().then(() => {
  try {
    importScripts(`${base}${lang}/sherpa-onnx-wasm-main-asr.js`, base + 'sherpa-onnx-asr.js')
  } catch {
    post({ type: 'error', code: 'engine_missing' })
  }
})
