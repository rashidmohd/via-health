#!/usr/bin/env node
/**
 * Builds the in-browser live preview assets (plan 0007 part 2) into public/live-stt/<VERSION>/.
 *
 * - sherpa-onnx WebAssembly ASR engine (Apache-2.0), pinned release, checksum-verified
 * - Kroko German streaming model (CC-BY-SA, see ATTRIBUTION), pinned by checksum
 * - The engine loads its model from an Emscripten data package; we build that package from the
 *   German model and point the engine's package metadata at it.
 *
 * Usage: node scripts/build-live-stt.mjs [--cache <dir>]
 * Needs `tar` with bzip2. Output is generated (not in git); the Docker build runs this script.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = 'sherpa-1.13.7-de-kroko-2025-08-06'

const ENGINE = {
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7/sherpa-onnx-wasm-simd-v1.13.7-en-asr-zipformer.tar.bz2',
  sha256: '21559527d65f7674a45834870e4f51b0af14be27d4de1043aa6f576d9b426acc',
  dir: 'sherpa-onnx-wasm-simd-v1.13.7-en-asr-zipformer',
}
const MODEL_BASE =
  'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06/resolve/main'
const MODEL_FILES = [
  ['encoder.onnx', '6e83993d6967ec7a3498b055b7e85ace85b5d64d1b1e8773cb29a43a11f5edb5'],
  ['decoder.onnx', '94a29592b403c53fa2231b478637da1ab4abcef7f5e46e432098416a4a3ed562'],
  ['joiner.onnx', '28356bff070aea51ab1d725a3278e81d19f9300f860d3248a7014292264df15a'],
  ['tokens.txt', '86e8370994ff2c01149ba8c4f8709aa93cdc18914b27a717e291e96faf39a6eb'],
]
const GLUE = 'sherpa-onnx-wasm-main-asr.js'
const DATA = 'sherpa-onnx-wasm-main-asr.data'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'live-stt', VERSION)
const cacheArg = process.argv.indexOf('--cache')
const cache = cacheArg > 0 ? process.argv[cacheArg + 1] : join(root, 'node_modules', '.cache', 'live-stt')

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function download(url, expected, file) {
  if (existsSync(file) && sha256(readFileSync(file)) === expected) return readFileSync(file)
  process.stdout.write(`downloading ${url}\n`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`download failed ${response.status}: ${url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const actual = sha256(buffer)
  if (actual !== expected) throw new Error(`checksum mismatch for ${url}: ${actual}`)
  writeFileSync(file, buffer)
  return buffer
}

if (existsSync(join(outDir, DATA)) && existsSync(join(outDir, GLUE))) {
  process.stdout.write(`live-stt ${VERSION} already built\n`)
  process.exit(0)
}

mkdirSync(cache, { recursive: true })
const tarball = join(cache, 'engine.tar.bz2')
await download(ENGINE.url, ENGINE.sha256, tarball)
const extract = join(cache, 'engine')
rmSync(extract, { recursive: true, force: true })
mkdirSync(extract, { recursive: true })
const wanted = [GLUE, 'sherpa-onnx-wasm-main-asr.wasm', 'sherpa-onnx-asr.js'].map((f) => `${ENGINE.dir}/${f}`)
execFileSync('tar', ['-xjf', tarball, '-C', extract, ...wanted])

const model = []
for (const [name, hash] of MODEL_FILES) {
  model.push([name, await download(`${MODEL_BASE}/${name}`, hash, join(cache, name))])
}

// Emscripten data package: files back to back + metadata with byte ranges.
let offset = 0
const entries = model.map(([name, buffer]) => {
  const entry = `{filename:"/${name}",start:${offset},end:${offset + buffer.length}}`
  offset += buffer.length
  return entry
})
const metadata = `loadPackage({files:[${entries.join(',')}],remote_package_size:${offset}})`

const glue = readFileSync(join(extract, ENGINE.dir, GLUE), 'utf8')
const pattern = /loadPackage\(\{files:\[.*?\],remote_package_size:\d+\}\)/s
if (!pattern.test(glue)) throw new Error('engine glue: package metadata not found (engine version changed?)')

rmSync(join(root, 'public', 'live-stt'), { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, GLUE), glue.replace(pattern, metadata))
for (const file of ['sherpa-onnx-wasm-main-asr.wasm', 'sherpa-onnx-asr.js']) {
  writeFileSync(join(outDir, file), readFileSync(join(extract, ENGINE.dir, file)))
}
writeFileSync(join(outDir, DATA), Buffer.concat(model.map(([, buffer]) => buffer)))
writeFileSync(
  join(outDir, 'ATTRIBUTION.txt'),
  [
    'Speech engine: sherpa-onnx (k2-fsa), Apache-2.0, https://github.com/k2-fsa/sherpa-onnx',
    'German model: Kroko ASR community model by Banafo, CC-BY-SA,',
    '  https://huggingface.co/Banafo/Kroko-ASR',
    '  packaged by https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06',
    'Commercial use: check with Kroko/Banafo before production (open decision, CLAUDE.md).',
    '',
  ].join('\n'),
)
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ version: VERSION, bytes: offset }) + '\n')
process.stdout.write(`live-stt ${VERSION}: model ${(offset / 1e6).toFixed(1)} MB -> ${outDir}\n`)
