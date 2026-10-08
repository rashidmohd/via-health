# 0003 — Login by email code, sent with Resend (EU region)

Status: accepted (2026-10-08)

## Decision
Therapists sign up and log in with a 6-digit code sent by email. Signup is open.
Emails are sent by Resend, with the sending domain created in region **eu-west-1 (Ireland)**,
called over HTTPS behind the `EmailSender` adapter. Replaces "passkeys + TOTP" in CLAUDE.md
for the prototype; passkeys may be added later as an optional faster login.

## Why
User's choice: simplest for therapists, no app or device setup.

## Consequences
- Resend is a US company: only the therapist's email address and the code go to Resend —
  never client data. A DPA with Resend is needed before production.
- Account security depends on the therapist's email account.
- Open signup: any therapist can create an account; RLS keeps accounts isolated.
