#!/usr/bin/env node
// Copies illustrations from the source library (../light next to the repo) into
// apps/web/src/design/illustrations/, cleans the file name and recolours the
// library palette to the olive design tokens (CLAUDE.md §7).
//
//   node .claude/skills/illustrations/scripts/add-illustration.mjs empty connection-lost
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const src = process.env.ILLUSTRATION_SRC ?? resolve(repo, '../light')
const out = join(repo, 'apps/web/src/design/illustrations')

// library colour → design token hex (lower-case keys)
const PALETTE = {
  '#0c4a4e': '#5c6b37', // teal primary → olive-700
  '#062f32': '#4a5729', // teal dark → olive-800
  '#c9e0e1': '#e8ecd9', // teal tint → olive-100
  '#6e8462': '#8a9a5b', // green → olive-500
  '#e2d9c8': '#efe6d2', // cream → sand
  '#dad2c3': '#e6e6de', // cream dark → border
  '#f7f4ee': '#fafaf6', // paper → bg
  '#0e1418': '#2b2a26', // ink → charcoal
  '#45474a': '#6b6a63', // grey → text-muted
  '#a8654a': '#c47a5a', // rust → clay
}

const clean = (name) =>
  name.replace(/\.svg$/, '').replace(/ \(\d+\)$/, '').replace(/^undraw_/, '').replace(/_[a-z0-9]{4}$/, '')

const names = process.argv.slice(2)
if (!names.length) {
  console.error('usage: add-illustration.mjs <name> [name…]   (names as listed in SKILL.md)')
  process.exit(1)
}
if (!existsSync(src)) {
  console.error(`source library not found: ${src} (set ILLUSTRATION_SRC)`)
  process.exit(1)
}
const files = readdirSync(src).filter((f) => f.endsWith('.svg'))
mkdirSync(out, { recursive: true })

let failed = false
for (const want of names.map(clean)) {
  const file = files.find((f) => clean(f) === want)
  if (!file) {
    console.error(`not found: ${want}`)
    failed = true
    continue
  }
  let svg = readFileSync(join(src, file), 'utf8')
  svg = svg.replace(/#[0-9a-fA-F]{6}\b/g, (hex) => PALETTE[hex.toLowerCase()] ?? hex)
  // decorative by default: the component sets alt="" / aria-hidden
  svg = svg.replace(/\s(artist|source)="[^"]*"/g, '')
  writeFileSync(join(out, `${want}.svg`), svg)
  console.log(`added src/design/illustrations/${want}.svg`)
}
process.exit(failed ? 1 : 0)
