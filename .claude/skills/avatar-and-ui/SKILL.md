---
name: avatar-and-ui
description: Use when building UI screens, the olive design system and tokens, layout and navigation, or the image-grid avatar (mouse-follow, emotion states, transitions) in apps/web/src/avatar and apps/web/src/design.
---

# UI and avatar

## Look and feel

Calm, white, spacious. Sidebar left (olive-50), content on #FAFAF6, one focal element per main screen.
Reference layout: clean SaaS dashboard; the Today screen's centrepiece is the avatar (in place of the reference's speaker object).

Tokens (CSS variables in `src/design/tokens.css`, also exported for Tailwind if used):

```css
:root{
  --olive-50:#F6F7F0; --olive-100:#E8ECD9; --olive-300:#C5CDA2; --olive-500:#8A9A5B; --olive-700:#5C6B37;
  --clay:#C47A5A; --sand:#EFE6D2; --charcoal:#2B2A26; --bg:#FAFAF6; --border:#E6E6DE;
  --danger:#C2412D; --warning:#C9963A; --info:#5B7A8C;
  --radius:8px; --radius-card:12px;
}
```

- Primary button: bg olive-700, white text. Secondary: white bg, olive-300 border, olive-700 text.
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
