# Plan 0002 — Therapist signup and login (email code)

Status: implemented (2026-10-08) — email code, open signup, Resend (EU region). Passkeys later.

## Flow
- **Sign up:** name + email → 6-digit code by email → enter code → account created, logged in.
- **Log in:** email → code → logged in. If the email has no account yet, one is created and the
  app asks for the name (so the API never reveals whether an email is registered).
- Clients never log in.

## Codes
- 6 digits from `secrets`, valid 10 minutes, max 5 wrong attempts, single use.
- Stored only as HMAC-SHA256 (`AUTH_SECRET`); email also stored only as HMAC (lowercased).
- Rate limits: 5 codes per email per hour, 30 per IP per hour → `too_many_requests`.
- All failures (wrong, expired, too many attempts) return the same `code_invalid`.

## Login session
- Cookie `sessio_auth`: random 256-bit token, `HttpOnly`, `Secure` (except dev), `SameSite=Lax`.
  Only its HMAC is stored in `auth_sessions`.
- Expires after 12 h, or 2 h without API activity. Logout revokes it.
- web (via.bandi.ae) and api (viaapi.bandi.ae) are the same site → cookie works with
  `credentials: 'include'`; CORS limited to `WEB_ORIGIN`.
- CSRF: non-GET requests must send `Origin == WEB_ORIGIN`.
- Each authenticated request runs in a transaction with `app.user_id` set → RLS applies.

## Email (ADR 0003)
`EmailSender` adapter in `app/adapters/email/`: Resend over HTTPS (no SDK), console sender in dev.
Email text in German or English (the UI language at the time of the request).
No PHI in emails: only the code.

## Database (additive migration)
| Table | Notes |
|---|---|
| `login_codes` | email_hash, code_hash, ip_hash, expires_at, attempts, consumed_at. No user data → no RLS |
| `auth_sessions` | user_id, token_hash, expires_at, last_seen_at, revoked_at. RLS by user_id |
| `users` | + CHECK email is lowercase |

Pre-login lookups use two narrow `SECURITY DEFINER` functions: user id by email, user id by
session token (also enforces expiry and touches `last_seen_at`). Nothing else bypasses RLS.
Audit log: `signup`, `login`, `logout` — IDs only.

## API
`POST /auth/email/start`, `POST /auth/email/verify`, `GET /auth/me`, `PATCH /auth/me`,
`POST /auth/logout`. Errors are codes, translated in the web app (de/en).

## UI (German + English)
Login page, signup page, "What should we call you?" step if name missing, sign-out and
language switch (DE/EN) in the sidebar. All app routes require login.

## Not in this step
Passkeys (faster login on own devices) — later, optional.

## Tests
Wrong / expired / reused code, attempt limit, rate limits, email case-insensitivity, no
enumeration (same response for new and existing email), session expiry / idle / logout,
cross-origin POST rejected, RLS on `auth_sessions`, web login + signup flow, de/en keys.
