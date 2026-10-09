# Plan 0013 — Reports page

Status: built 2026-10-09.

## Goal
The **Reports** nav item lists the therapist's **approved** session notes across all clients.
A draft stays with its session (Sessions → session → note) until the therapist approves it;
from then on it also appears under Reports. Decided by the product owner.

## API
`GET /reports?client_id=` → approved notes, newest approval first, max 200. Per row: session id,
client id and name, session start, approval time, session number and type (from the note
header), the note's topics (same shortened text as the session card), number of addenda.
RLS applies as everywhere; no new table, no migration. Approved notes are not re-encrypted here —
when therapist signing (STATUS item 2) lands, this list must read only metadata the server can
still see (or the browser decrypts the rows).

## Web
`/reports` (`features/reports/ReportsPage.tsx`): table like Sessions (session date + number,
client + topics, type, approval date + addenda), search by client, row opens
`/sessions/:id/report` (read-only view with print and addenda). Empty state uses the
`note-list` illustration. The list refreshes after approve and addendum. Strings de + en.

## Not in this plan
Filter by client or date range, export, signed state (comes with therapist keys).

## Tests
Backend: only approved notes listed, addenda counted, client filter, other therapist sees none.
Web: rows, link target, search, German empty state.
