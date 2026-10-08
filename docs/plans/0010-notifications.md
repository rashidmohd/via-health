# Plan 0010 — Notification hub

Status: part 1 implemented (2026-10-09): events table, worker writes, Notifications tab with
unread badge, mark read. Later: toast, browser (system) notifications, hub panel, 90-day clean-up.

## Goal
The therapist learns without watching a page when work in the background is done or needs
them: transcript ready, note draft ready, something failed. One place in the app (a bell in the
sidebar) lists these events; optionally the browser shows a system notification.

## Events (written by the worker, in the same transaction as the state change)
| Kind | When | Link |
|---|---|---|
| `transcript_ready` | session → `transcribed` | session page |
| `transcription_failed` | session → `failed` | session page |
| `report_ready` | note draft stored (`draft`) | note page |
| `report_failed` | note draft `failed` | note page |
| `report_no_consent` | no AI consent at drafting time | note page |
Computed, not stored: "notes to review older than a day" (already on Today) shows as a count
at the top of the hub.
Not a notification: anything clinical (rules 11–13). The avatar may nod on `transcript_ready` /
`report_ready` (existing app-event whitelist).

## Privacy
- Rows hold **ids and a kind code only** — no client name, no text (rule 3). The API joins the
  client name when the logged-in therapist reads the hub.
- **System (browser) notifications never contain a client name** — they can appear on the lock
  screen or during screen sharing: "Ein Transkript ist fertig" / "A transcript is ready".
  Off by default; the therapist switches them on in the hub (browser permission prompt).
- No Web Push (push services of browser vendors, e.g. Google FCM, run outside our control and
  would be a new external service). System notifications therefore appear only while a Sessio
  tab is open (also in the background).

## Database (additive)
`notifications(id, user_id, kind, session_id, created_at, read_at)` — RLS own rows; worker may
INSERT only; app may SELECT and UPDATE `read_at`. Index (user_id, created_at). Rows older than
90 days are removed by `retention_sweep` later.

## API
- `GET /notifications?limit=30` → items (kind, session_id, client_name, created_at, read) +
  `unread` count + `notes_to_review` count.
- `POST /notifications/read` (`ids` or `all: true`).

## Web (de/en)
- Bell in the sidebar with unread badge; panel lists events, newest first, each linking to the
  session or note; "Mark all as read". Polls every 30 s (no websockets; same pattern as the
  session pages).
- New unread event while the app is open → small toast at the bottom ("Transkript fertig —
  Anna Weber · Öffnen") and, if enabled, a system notification without the name.
- Opening the linked page marks the matching events as read.

## Tests
Worker writes exactly one notification per state change (also on retry/idempotent runs); no
PHI in rows; other therapist cannot see them (RLS); worker cannot read them; read/unread;
system notification text has no client name; toast only for new events.
