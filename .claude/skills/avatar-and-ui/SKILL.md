---
name: avatar-and-ui
description: Use when building UI screens, the olive design system and tokens, layout and navigation, the Rive avatar (state machine contract, emotions, placeholder), the listening ring, or profile picture settings in apps/web/src/avatar and apps/web/src/design.
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
| Settings | profile picture, avatar reactions, microphone; later templates, hotwords |

Session screen: large record button (first time on a device: 5 s mic test first), timer, mic health (level meter + voice on/off), sync badge, live transcript (muted, labelled "Vorschau"), chips panel, bookmark button. Avatar paused in its ring; the red dot + "Aufnahme läuft" stays separate from the ring.

## Avatar: Rive character (plan 0011, ADR 0010)

One illustrated, rigged Rive character (designer-made, rights held). It reacts **only to app state**
— never to what is said or how anyone sounds. No emotion recognition.

Files: `src/avatar/` — `mood.ts` (state machine, tested), `events.ts` (payload-free app events),
`useAvatarMood.ts`, `rive.ts` (contract), `RiveAvatar.tsx` (placeholder / lazy character),
`RiveCanvas.tsx` (Rive hooks, code-split), `AvatarRing.tsx` + `ring.ts`, `AppAvatar.tsx`
(`UserAvatar` = chosen kind, `AppAvatar` = avatar + ring for non-recording screens), `settings.ts`.

Assets: `public/avatar/sessio-avatar.riv` (not delivered yet) and `public/avatar/placeholder.png`.
`RiveAvatar` fetches the .riv once; if it is missing or doesn't start with `RIVE`, the placeholder
image is shown with the same props and no Rive code/WASM is loaded. The Rive WASM is bundled and
served from our origin (`RuntimeLoader.setWasmUrl` + `setWasmFallbackUrl`) — never the CDN default.

### State machine contract (keep names identical)

Artboard `Avatar`, state machine `Avatar`.

| Input | Type | Values / effect |
|---|---|---|
| `lookX` | Number | −100…100, pointer x (head + eyes follow) |
| `lookY` | Number | −100…100, pointer y |
| `emotion` | Number | 0 attentive · 1 welcome · 2 thinking · 3 encouraging · 4 pleased · 5 concern · 6 still |
| `recording` | Boolean | true → no tracking, calm still pose |
| `noted` | Trigger | ≤1 s glance/nod for a new capture chip (only if the therapist enabled reactions) |

Phase 2 (avatar builder, not now): Number inputs `hair`, `hairColor`, `skin`, `glasses`, `beard`, `top`.

### App event → emotion

| App event | Emotion | Code |
|---|---|---|
| login / Today idle | `welcome` → `attentive` after 3 s | `WELCOME_MS` |
| report drafting, transcript processing | `thinking` | `processing` |
| name step done, client added | `encouraging` (3 s) | `onboarding.step`, `client.created` |
| report approved, upload done, transcript ready | `pleased` → `attentive` after 3 s | `report.signed`, `upload.done`, `transcript.ready` |
| offline, upload/processing error, consent missing | `concern` | `online`, `problem` |
| recording active | `still` + `recording = true` | active recorder |
| new capture chip (opt-in) | fire `noted` | `capture.noted` |

Moods come only from `useAvatarMood` (app state + `emitAvatarEvent`). Components never set
emotions ad hoc. Events carry no payload — nothing from a session can reach the avatar.

Component rules:
- `prefers-reduced-motion`: no pointer tracking; emotions still switch.
- While recording: `recording = true`, then `rive.pause()` after 600 ms (frees CPU for audio,
  crypto and WASM STT). A `noted` glance plays briefly, then pauses again.
- `aria-hidden`; every state is also shown as text on screen.

## Listening ring

`AvatarRing` wraps any avatar (character, initials, later photo). Pure CSS, only
`transform`/`opacity` animate.

| Ring state | When | Look |
|---|---|---|
| `idle` | not recording | 2px olive-300 border |
| `silent` | recording, no voice | 3px olive-500 border |
| `listening` | recording, voice detected | two staggered ripples, 2.4 s |
| `processing` | report drafting / transcript processing | rotating olive arc, 2.8 s |

`ringState({ recording, voiceActive, processing })` maps state. Badges: check (`done`: note
approved / upload synced — neutral colour, olive is not "success"), cloud-off (`offline`,
warning colour). Status text always next to it.

Ring rules:
- Binary voice state only — **never** scale the animation with loudness.
- No difference between therapist and client voices.
- Driven only by the voice activity signal (`useVoiceState`, `offline-recorder` skill); voice
  activity is shown only on the recording screen.

## Profile picture (Settings)

| Option | Status | Notes |
|---|---|---|
| Illustrated avatar (Rive) | built (default) | animated, all emotions |
| Initials | built | olive-100 circle, olive-800 text (`Initials` with `size`) |
| My photo | plan 0012 | static photo in the ring; optional ±4° tilt toward the pointer, off while recording; crop + 512×512 WebP re-encode (strips EXIF); access-controlled object; deleted with the account |
| Build my avatar | later | Rive part variants; store only a config like `{ "hair":3,"hairColor":2,"skin":4,"glasses":1 }`; every trait picked manually, never detected from a photo |
| Avatar from my photo | later | check EU availability + zero retention first |

Settings are per device for now (`settings.ts`, localStorage `sessio.avatar`); they move to the
account with plan 0012. Clients never get photo uploads; client avatars stay initials.

## Accessibility

WCAG AA contrast, visible focus rings (olive-500), keyboard-operable record/stop (with confirmation for stop), German and English strings via i18n from day one.
