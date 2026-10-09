# 0018 — Leave transcript turns out of the AI draft; no automatic draft

Status: accepted (2026-10-09), decided by the product owner

## Context
Therapists want to keep some parts of a session away from the AI, e.g. small talk, a third
person's story, or something said "off the record", before the note is drafted. Until now the
worker drafted the note on its own about 15 s after the final transcript, so there was no time
to review first. ADR 0006 makes the transcript part of the record: the original has to stay
readable, and redaction belongs on export copies, never on the record.

## Decision
- **No automatic draft.** `find_draft_work` only picks reports the therapist asked for
  (`POST /sessions/{id}/report/draft`). The note screen shows the transcript first, with
  "Draft with AI" and "Write manually" next to it.
- **Leave out, don't delete.** Each line has "Leave out" / "Include again"
  (`POST /sessions/{id}/transcript/exclusions`, body `{start_ms, end_ms, excluded}`). Stored
  as `[start_ms, end_ms]` ranges in `transcripts.excluded_ranges`: times only, no text, max
  500, like `speaker_overrides`. The transcript text is unchanged.
- A piece of the transcript is left out when its middle lies in a range. Left-out turns never
  join kept neighbours, so speaker corrections cannot pull left-out text back in.
- The draft and check calls get only kept turns. Confirmed notes (captures) whose time is in
  a left-out turn are not sent either.
- Locked while a draft is being written (`report_busy`) and after approval (`report_approved`).
  While a draft exists, lines can still be left out or included; it applies to the next draft.
- Left-out lines stay visible to the therapist: dimmed, struck through, labelled "Left out of
  the AI draft". Every change is audited (`transcript_turn_excluded` / `_included`, ids only).

## Consequences
- One extra click per session ("Draft with AI"). The note is no longer waiting when the
  therapist opens it.
- Leaving out is not redaction. The text stays in the record and in any record export. True
  removal from the record (e.g. third-party rights, §630g) would need its own decision.
- A statement in an existing draft may still cite a turn that was left out later, until the
  therapist drafts again. The screen says so.
- Speaker corrections are still not locked after approval (an existing gap, unchanged here).
