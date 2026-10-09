# 0016 — Recording dock, in-app confirm dialog, own date field

Status: accepted (2026-10-09)

## Context
- A recording keeps running when the therapist leaves the recording screen (the recorder lives
  outside React), but nothing on other screens showed it. Recorder problems (`mic_lost`,
  `storage_full`) were held in the recording screen's state, so they were lost there.
  The "leave site?" warning was only active on the recording screen.
- Confirmations used `window.confirm`: browser-styled, "OK/Cancel" buttons, no German/English
  control, blocks the page thread.
- Date of birth used `<input type="date">`, which looks and behaves differently per browser and
  follows the browser locale, not the app language.

## Decision
- **Recording dock**, not a navigation block. Leaving the recording screen is allowed (the
  therapist may need client details mid-session); a dock at the bottom of every other screen
  shows the recording indicator, client name, timer, any recorder problem (`role="alert"`),
  "Back to recording" and Stop (confirmed). For 6 s after leaving it says the recording
  continues in the background. Client and problem live in `recorder/active.ts`.
- Signing out while recording asks first, then stops the recording before logging out.
- `beforeunload` warning while recording on every screen. Browsers do not allow custom content
  in that prompt, so it stays the browser's own.
- **`confirmDialog()`** (`design/confirm.ts`, shown by `ConfirmHost`) replaces `window.confirm`
  everywhere: `alertdialog`, the action button names the action, destructive questions focus
  Cancel, Escape and backdrop cancel.
- **`DateField`** (`design/DateField.tsx`): typed day first (DE `TT.MM.JJJJ`, EN `DD/MM/YYYY`,
  two-digit years and ISO accepted), plus a calendar popover with month/year selects, Monday
  first, keyboard navigation. Month and day names from `Intl` in `de-DE` / `en-GB`.

## Consequences
- No new dependency. `window.confirm`, `alert` and `type="date"` should not be used again.
- Tests answer dialogs with `confirmInDialog()` from `test-utils`.
