---
name: avatar-and-ui
description: Use when building UI screens, the olive design system and tokens, layout and navigation, or the image-grid avatar (mouse-follow, emotion states, transitions) in apps/web/src/avatar and apps/web/src/design.
---

# UI and avatar

## Look and feel

Calm, white, spacious. Sidebar left (olive-50), content on #FAFAF6, one focal element per main screen.
Reference layout: clean SaaS dashboard; the Today screen's centrepiece is the avatar (in place of the reference's speaker object).

Tokens live in `src/design/tokens.css` (ADR 0009). Never hardcode hex, sizes or shadows in components — use:
palette (`--olive-*`, `--clay`, `--sand`, `--charcoal`, `--danger`, `--warning`, `--info`), surfaces
(`--canvas` behind the shell, `--surface-muted` main panel, `--surface` cards), text (`--text`, `--text-muted`,
`--text-subtle`), type (`--text-xs` … `--text-2xl`, Inter), space (`--space-1` … `--space-10`, 4 px grid),
shape (`--radius-sm/--radius/--radius-card/--radius-panel`), elevation (`--shadow-xs/sm/md`, `--ring`).

Files: `design/base.css` = shared components, `design/shell.css` = sidebar/top bar/drawer,
`src/index.css` = feature styles only. Shell components: `features/shell/Sidebar.tsx`, `Topbar.tsx`.

Building blocks (classes in `base.css`):
- Page: `<section className="page">` → `<header className="page-header">` with `h1` (+ optional muted `p`) and actions right.
- Buttons: `primary`, `secondary`, `ghost`, `icon-button` (+ `bare`); links styled as buttons add `button`. One primary per view.
- Icons: `lucide-react` only, `className="icon" aria-hidden="true"`; icon-only buttons need `aria-label`.
- Cards: `card` (+ `card-header`); tables: `data-list` rows; labels: `eyebrow`.
- Number tiles: `stats` > `stat` (`stat-label` with icon, `stat-value`). Count work only — never scores about clients (rule 11).
- Status: `badge info|attention|neutral` — always text, colour only supports it.
- Empty: `empty` with `empty-icon`, one sentence, one action. Loading: `skeleton` blocks, not "Loading…" text, for lists.
- Tables: `table-card` > `table-toolbar` (`search` with icon, `segmented` filter with counts) + `<table className="table">`; rows open via a `stretched` link on the name, other row controls get `above`. Collapse to stacked rows under 720 px (see `.clients-table`).
- Lists in cards: `item-list` > `item` (`Initials` or `item-time`, `item-main`, badge/`item-action`); empty inside a card: `card-empty`. `ListSkeleton` while loading.
- Shared helpers: `Initials` (design/), `sessionStatus()` (features/sessions/status.ts) for one status label per session, `formatTime`/`formatLongDate`/`isSameDay` (features/format.ts).
- New nav items: add to `features/nav.ts` with a `group` and an icon in `NAV_ICONS`; breadcrumbs follow automatically.

- Primary button: olive-700, white text. Secondary: white, hairline border, charcoal text.
- Clay only for small attention badges (e.g. "3 reports to sign").
- Recording indicator: danger red dot + text "Aufnahme läuft" — never colour alone.
- Olive is brand, not "success".
- Sentence case, plain language, no exclamation marks in system copy.
- Support dark mode via the same tokens later; don't hardcode hex in components.

## Screens

| Nav | Content |
|---|---|
| Today | avatar, greeting, today's sessions, reports waiting, "Start session" |
| Clients | list: name (decrypted locally), last session, consent status, next appointment |
| Sessions | calendar + list, sync status per session |
| Reports | drafts to review, signed reports |
| Keys | key status, recovery key check, lock |
| Settings | templates, hotwords, avatar options |

Session screen: large record button, timer, sync badge, live transcript (muted, labelled "Vorschau"), chips panel, bookmark button. Avatar still or hidden.

## Avatar: image grid

Realistic or illustrated face rendered as pre-generated frames (e.g. LivePortrait). Only use a face we hold rights to (AI-generated person or signed release).

Assets:
```
public/avatar/attentive/r{0-8}_c{0-8}.webp      # 9x9 look-around grid (default state)
public/avatar/{emotion}/r{0-2}_c{0-2}.webp      # 3x3 per other emotion
public/avatar/transitions/{from}-to-{to}/{00-11}.webp
```

Emotions (app state only): `attentive`, `welcome`, `thinking`, `encouraging`, `pleased`, `concern`, `still`.

| App event | Emotion |
|---|---|
| login / Today idle | `welcome` → `attentive` |
| report processing | `thinking` |
| onboarding step done, first client added | `encouraging` |
| report signed, all synced | `pleased` |
| offline, error, consent missing | `concern` (soft) |
| recording active | `still` (no tracking, no reactions) |
| `capture.noted` (only if therapist enabled) | 1 s glance, then back |

**Never** derive avatar state from what the client or therapist says or how they sound. No emotion recognition.

Component contract:
```tsx
<Avatar emotion={emotion} trackPointer={!recording} size={160} />
```
- Map pointer position to the nearest grid cell, throttled with `requestAnimationFrame`.
- Preload `attentive` on first paint; lazy-load other sets after login.
- Transitions: play the frame sequence (≈30 fps) or crossfade 200 ms if missing.
- `prefers-reduced-motion`: show a single front-facing frame, no tracking, no transitions.
- Pause everything while recording to free CPU for audio, encryption and WASM STT.
- Decorative: `aria-hidden`, all state also communicated in text.

## Accessibility

WCAG AA contrast, visible focus rings (olive-500), keyboard-operable record/stop (with confirmation for stop), German and English strings via i18n from day one.
