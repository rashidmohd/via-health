# 0015 — Spot illustrations from the unDraw library

Status: accepted (2026-10-09)

## Context
Empty states, login, offline and confirmation pages show only a small lucide icon. They feel
bare next to the reference dashboard, and first-run screens give little guidance. We have a
local library of 386 unDraw SVGs (`../light/`, recoloured teal/cream), free for commercial use
without attribution.

## Decision
- Use one spot illustration per view on full-page empty states, onboarding, login, full-page
  errors and confirmation pages. Never on the recording screen or the Today screen (the avatar
  is the focal element there), never in cards, rows, dialogs or toasts.
- Pick by app state only, never by session content (rules 11–12). No AI imagery that suggests
  the AI advises (ADR 0008).
- Copy only the files we use into `apps/web/src/design/illustrations/` with
  `.claude/skills/illustrations/scripts/add-illustration.mjs`, which recolours the library
  palette to the olive tokens. Render as Vite assets with `<img alt="" aria-hidden>`.
- The moment → file map and the do-not-use list live in the `illustrations` skill.

Amendment (2026-10-09): the one exception on Today is the first-run setup card: keys
(`invite-only`), then first client (`nice-to-meet-you`). One step at a time, below the avatar
hero, gone once setup is done.

## Consequences
- No new dependency; a few kB per used illustration, cached as static assets.
- Colours are fixed at copy time; dark mode later needs per-theme files or inline SVG with
  token variables.
- The library stays outside the repo; adding a new illustration needs that folder (or
  `ILLUSTRATION_SRC`).
