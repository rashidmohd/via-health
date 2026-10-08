# 0006 — The transcript is part of the patient record

Status: accepted (2026-10-08)

## Context
Research (docs/research/german-session-reports.md): a kept transcript is client data the client
may inspect (§630g BGB, GDPR Art. 15) and arguably falls under the 10-year retention of §630f BGB.
Option (a): keep it as part of the record. Option (b): delete it when the report is signed.
The user chose (a).

## Decision
- The final transcript (segments, words, speaker labels and corrections) is part of the
  record of a session, next to the signed report.
- From signing on it is **read-only**. Speaker corrections after signing are added as dated
  versions; the original stays readable (§630f Abs. 1).
- It is kept **10 years after the end of treatment**, like the report, and then deleted by
  `retention_sweep`.
- It is encrypted together with the signed report (CLAUDE.md rule 7: therapist key + recovery
  key). Until therapist keys exist it stays under the interim server key (ADR 0004).
- **Audio is not part of the record** and is still deleted at signing (rule 6).
- `transcript_windows` stay temporary (deleted after the final transcript is stored).

## Consequences
- The data export for a client's inspection request includes the transcript. Redaction for
  third-party rights (§630g Abs. 1) is done on the export copy, never on the record.
- The transcript contains every word, including names of other people. Therapists must know
  that the client can read it; the consent text has to say the transcript is kept 10 years
  (placeholder texts v0, ADR 0002 — lawyer review).
- Needs an end-of-treatment date per client to start the 10-year clock (later, with
  `retention_sweep`).
- Storage grows with session length (text only, small).
