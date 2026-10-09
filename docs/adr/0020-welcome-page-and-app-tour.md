# 0020 — Welcome page and app tour

Status: accepted (2026-10-09)

## Decision
- New accounts (no keys yet) see a full-page welcome once, after the name step: the `hello`
  illustration, three points (encrypted offline recording, transcript + draft note to review,
  notes encrypted with your key), and "Show me around" / "Skip for now". Existing users are
  never interrupted.
- The tour is our own small component (`features/onboarding/Tour.tsx`), no dependency: a
  spotlight on elements marked `data-tour`, a step card with Back / Next / End, Esc and arrow
  keys. Eight steps over the shell: Start session, each nav item, upload status. If a target is
  hidden (sidebar on small screens), the card shows centred.
- Never on the recording screen. Can be restarted from Settings → App tour.
- "Welcome seen" is a per-browser localStorage flag keyed by user id (no personal data). If
  storage is blocked the welcome is skipped rather than shown every time.

## Why
User's request: a welcome with feature info and a guided tour. The welcome explains why; the
Today setup card (keys, then first client) shows what to do next.

## Consequences
- The welcome can show again on a new browser; move the flag to the user row when that matters.
- Copy follows ADR 0008: the AI drafts, the therapist reviews and signs. German and English.
- New nav items need a `data-tour` target and a `tour.steps.<target>` text, or they are left out.
