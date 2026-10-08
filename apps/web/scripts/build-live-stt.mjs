#!/usr/bin/env node
/**
 * Builds the in-browser live preview assets (plan 0007 part 2) into public/live-stt/<VERSION>/.
 *
 * - sherpa-onnx WebAssembly ASR engine (Apache-2.0), pinned release, checksum-verified
 * - Kroko streaming models, German and English (CC-BY-SA, see ATTRIBUTION), pinned by checksum
 * - The engine loads its model from an Emscripten data package. Per language we build that
 *   package and a copy of the engine glue whose package metadata points at it:
 *     <VERSION>/sherpa-onnx-wasm-main-asr.wasm, sherpa-onnx-asr.js   (shared)
 *     <VERSION>/<lang>/sherpa-onnx-wasm-main-asr.js, .data            (per language)
 * - A new VERSION gives every file a new URL, so CDN/browser caches can never serve old files.
 *
 * Usage: node scripts/build-live-stt.mjs [--cache <dir>]
 * Needs `tar` with bzip2. Output is generated (not in git); the Docker build runs this script.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = 'sherpa-1.13.7-kroko-2025-08-06-de-en'

const ENGINE = {
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7/sherpa-onnx-wasm-simd-v1.13.7-en-asr-zipformer.tar.bz2',
  sha256: '21559527d65f7674a45834870e4f51b0af14be27d4de1043aa6f576d9b426acc',
  dir: 'sherpa-onnx-wasm-simd-v1.13.7-en-asr-zipformer',
}
const MODELS = {
  de: {
    base: 'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-de-kroko-2025-08-06/resolve/main',
    files: [
      ['encoder.onnx', '6e83993d6967ec7a3498b055b7e85ace85b5d64d1b1e8773cb29a43a11f5edb5'],
      ['decoder.onnx', '94a29592b403c53fa2231b478637da1ab4abcef7f5e46e432098416a4a3ed562'],
      ['joiner.onnx', '28356bff070aea51ab1d725a3278e81d19f9300f860d3248a7014292264df15a'],
      ['tokens.txt', '86e8370994ff2c01149ba8c4f8709aa93cdc18914b27a717e291e96faf39a6eb'],
    ],
  },
  en: {
    base: 'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06/resolve/main',
    files: [
      ['encoder.onnx', 'd4881c57449d581e0770fd53fa66c2fdc6cd167d92ece7c715e603defc96d9d4'],
      ['decoder.onnx', '455ba38466fce8d5a57e7db68a323b684079ca4d9e1dd93a740d9b2429aae3b1'],
      ['joiner.onnx', 'd406f616736350e2a7df3e39398b78eb2fc1a2ca6973a19d3853fa3227e25b52'],
      ['tokens.txt', '396dbeb5f4858875690716084f54e90d339679d0ba3e6b5b584f3d7589254d2d'],
    ],
  },
}
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

if (Object.keys(MODELS).every((lang) => existsSync(join(outDir, lang, DATA)))) {
  process.stdout.write(`live-stt ${VERSION} already built\n`)
  process.exit(0)
}

mkdirSync(cache, { recursive: true })
const tarball = join(cache, 'engine.tar.bz2')
await download(ENGINE.url, ENGINE.sha256, tarball)
const extract = join(cache, 'engine')
rmSync(extract, { recursive: true, force: true })
mkdirSync(extract, { recursive: true })
// Use the archive's own member names: they may start with "./", which GNU tar (Linux, Docker)
// does not match against "dir/file" — BSD tar (macOS) does.
const members = execFileSync('tar', ['-tjf', tarball], { encoding: 'utf8', maxBuffer: 1 << 20 })
  .split('\n')
  .filter(Boolean)
const wanted = [GLUE, 'sherpa-onnx-wasm-main-asr.wasm', 'sherpa-onnx-asr.js'].map((file) => {
  const member = members.find((m) => m.replace(/^\.\//, '') === `${ENGINE.dir}/${file}`)
  if (!member) throw new Error(`engine archive: ${file} not found`)
  return member
})
execFileSync('tar', ['-xjf', tarball, '-C', extract, ...wanted])

const glue = readFileSync(join(extract, ENGINE.dir, GLUE), 'utf8')
const pattern = /loadPackage\(\{files:\[.*?\],remote_package_size:\d+\}\)/s
if (!pattern.test(glue)) throw new Error('engine glue: package metadata not found (engine version changed?)')

rmSync(join(root, 'public', 'live-stt'), { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
for (const file of ['sherpa-onnx-wasm-main-asr.wasm', 'sherpa-onnx-asr.js']) {
  writeFileSync(join(outDir, file), readFileSync(join(extract, ENGINE.dir, file)))
}

const manifest = { version: VERSION, languages: {} }
for (const [lang, { base, files }] of Object.entries(MODELS)) {
  const model = []
  for (const [name, hash] of files) {
    model.push([name, await download(`${base}/${name}`, hash, join(cache, `${lang}-${name}`))])
  }
  // Emscripten data package: files back to back + metadata with byte ranges.
  let offset = 0
  const entries = model.map(([name, buffer]) => {
    const entry = `{filename:"/${name}",start:${offset},end:${offset + buffer.length}}`
    offset += buffer.length
    return entry
  })
  const metadata = `loadPackage({files:[${entries.join(',')}],remote_package_size:${offset}})`
  mkdirSync(join(outDir, lang), { recursive: true })
  writeFileSync(join(outDir, lang, GLUE), glue.replace(pattern, () => metadata))
  writeFileSync(join(outDir, lang, DATA), Buffer.concat(model.map(([, buffer]) => buffer)))
  manifest.languages[lang] = { bytes: offset }
  process.stdout.write(`live-stt ${VERSION} ${lang}: model ${(offset / 1e6).toFixed(1)} MB\n`)
}

writeFileSync(
  join(outDir, 'ATTRIBUTION.txt'),
  [
    'Speech engine: sherpa-onnx (k2-fsa), Apache-2.0, https://github.com/k2-fsa/sherpa-onnx',
    'Models: Kroko ASR community models (German, English) by Banafo, CC-BY-SA,',
    '  https://huggingface.co/Banafo/Kroko-ASR',
    '  packaged by https://huggingface.co/csukuangfj (sherpa-onnx-streaming-zipformer-{de,en}-kroko-2025-08-06)',
    'Commercial use: check with Kroko/Banafo before production (open decision, CLAUDE.md).',
    '',
  ].join('\n'),
)
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest) + '\n')
process.stdout.write(`live-stt ${VERSION} -> ${outDir}\n`)
