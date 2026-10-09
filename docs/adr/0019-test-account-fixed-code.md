# 0019 — One test account with a fixed sign-in code

Status: accepted (2026-10-09)

## Decision
`TEST_LOGIN_EMAIL` + `TEST_LOGIN_CODE` (6 digits) name one account whose sign-in code never
changes. For that email, `/auth/email/start` stores the fixed code instead of a random one and
sends no email; `/auth/email/verify` is unchanged. Both empty = off (the default).
The API refuses to start with these set when `APP_ENV=prod`.

## Why
User's request: a stable account (test@sessio.io) for demos and testing, without a mailbox.

## Consequences
- Anyone who knows the code can sign in to that account, so it holds **test data only**.
- The code is a secret: Railway variable only, never committed.
- Rate limits and the 5-attempt lock still apply (≈25 guesses per hour per email).
- Remove before real clients; the prod check enforces it.
