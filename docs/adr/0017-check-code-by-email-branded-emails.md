# 0017 — Recovery check code by email; branded system emails

Status: accepted (2026-10-09), decided by the product owner

## Context
Key setup (plan 0014) ends with typing the check code from the downloaded recovery file. It
proves the file was saved and opened. Some therapists do not understand where to find the code.
Separately, system emails were plain text without the Sessio brand.

## Decision
- On the recovery step, a link "Send it to me by email" emails the check code to the
  therapist's own account address (`POST /keys/check-code-email`). A confirm dialog asks for
  consent every time and says the email does not replace the file. Consent is stored in the
  audit log (`check_code_emailed`, `meta.consent`). Only during setup, max 3 per hour.
- The email holds the check code only, never the recovery key. The code is not secret (the
  end of a public fingerprint), so this leaks nothing.
- System emails (login code, check code) are sent as plain text plus branded HTML: table
  layout, inline styles, olive tokens, logo as PNG from the web app at the fixed path
  `/email/sessio-logo.png` (SVG is not shown by Gmail/Outlook; hashed `/assets/` names
  change per build). Logo URL = `WEB_ORIGIN` + path.
- Same font as the UI: Inter (latin subset, OFL) via `@font-face` from `/email/inter-latin.woff2`
  on our origin, never Google Fonts. Apple Mail, Outlook for Mac and Thunderbird show it; Gmail
  and Outlook for Windows fall back to the system font (San Francisco, Segoe UI, Roboto).

## Consequences
- The setup check no longer proves the recovery file exists for therapists who use the email.
  If such a therapist loses the file and forgets the passphrase, signed records are lost for
  good. Revisit before real clients: "choose the saved file" check and periodic re-check.
- Emails load the logo from our own web origin (EU, Railway); email clients may block remote
  images, so the `alt="Sessio"` text shows instead.
- No new external service: Resend (ADR 0003) already sends the login code.
