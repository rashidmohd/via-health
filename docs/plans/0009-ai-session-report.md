# Plan 0009 — AI session report (draft, review, approve)

Status: implemented (2026-10-08). Real-model check 2026-10-09 (gemini-3.8-flash, Gemini API,
synthetic 3-min German VT session, 6 runs): no names sent; no clinical fields; suicidality
question and emotion words left out; sources correct. Draft 7–18 s, check 4–42 s.
Fixes from the check: the model kept `[Person 1]`, which was restored to the real name → prompt
now forbids placeholders, client/therapist placeholders restore to role words, other names are
restored but flagged ("Enthält einen Namen", blocking). Check prompt sharpened (v1.3): flags fell
from 5/12 to ~1 per run, mostly real (added detail, dropped "wenigstens").
Names are snapshotted per session at start (`sessions.llm_names_enc`) and again on every
"draft" request, so the worker never reads client identity. Based on docs/research/german-session-reports.md and
ADRs 0006 (transcript is part of the record), 0007 (plain-text processing, name placeholders),
0008 (AI documents, never assesses).

## Goal
After a session, Gemini drafts a German (or English) session note in the standard German
structure (BPtK/PTK NRW "Verlaufsdokumentation"). The therapist checks every AI sentence against
the transcript, writes the clinical fields, and approves the note. PGP signing, audio
crypto-shred and locking the transcript into the record come with therapist keys (next step).

## Template v1: `verlauf_v1` — "Sitzungsdokumentation"
Field codes go to the browser; labels are de/en UI strings. AI fields are the only ones in the
model's output schema (ADR 0008).

| Code | DE | EN | Who |
|---|---|---|---|
| `date`, `time`, `session_no` | Datum, Beginn–Ende, Sitzungsnummer | Date, start–end, session no. | System, editable |
| `session_type` | Sitzungsart (Sprechstunde, Probatorik, Akutbehandlung, KZT, LZT, …) | Session type | Therapist |
| `attendees` | Anwesende | Attendees | System from speaker roles, editable |
| `homework_followup` | Umsetzung seit letzter Sitzung / Hausaufgaben | Follow-up / homework | AI |
| `current_situation` | Aktuelle Situation | Current situation | AI |
| `topics` | Themen der Sitzung | Session topics | AI |
| `interventions` | Interventionen und Reaktionen | Interventions and responses | AI |
| `agreements` | Vereinbarungen / neue Hausaufgaben | Agreements / new homework | AI (+ task chips) |
| `next_session` | Planung nächste Sitzung | Plan for next session | AI (+ appointment chips) |
| `mental_status` | Psychischer Befund / Veränderungen | Mental status / changes | Therapist only |
| `understanding` | Psychotherapeutisches Verständnis | Clinical understanding | Therapist only |
| `progress` | Behandlungsentwicklung | Treatment progress | Therapist only |
| `crisis` | Suizidalität / Krise und Maßnahmen | Suicidality / crisis | Therapist only, never defaulted |
| `notable` | Besonderheiten | Notable events | Therapist only |
| footer | Erstellt mit KI-Unterstützung; geprüft und freigegeben von … am … | Drafted with AI assistance; approved by … on … | System |

Templates live in code (`app/domain/report_templates.py`), versioned; the report stores
`template_code` + `template_version`.

## Flow
1. Trigger: transcript stored and `refine_status` ∈ {done, failed, skipped} → worker queues
   `draft_report(session_id)` (job id per session, idempotent). Requires valid `ai_processing`
   consent at job start; otherwise no draft, status `no_consent` (therapist writes manually).
2. Worker (in memory only):
   - decrypt transcript (speaker overrides applied) and confirmed captures;
   - replace names with placeholders (ADR 0007);
   - **call 1 — draft:** structured output, JSON schema = AI fields only. Each field is
     `{status: "content" | "not_discussed", statements: [{text, kind, refs: [segment idx]}]}`,
     `kind` ∈ reported | intervention | agreement | plan. Temperature low. Language = session
     language.
   - **call 2 — check:** each statement + its cited segments → `supported | partly | unsupported`.
     Statements without refs are `unsupported`.
   - fixed word list (de/en, in code) flags judgmental or emotion words ("wirkte", "verweigert",
     "manipulativ", "behauptet", "seemed", "refused" …) → `flag: "wording"`.
   - put names back, store the draft encrypted (interim key, ADR 0004); status `draft`.
3. Failure: 3 attempts with backoff → `failed` + reason code; "Try again" and "Write manually".

### Prompt rules (system prompt versioned in code, `prompt_version` stored)
Only content from the transcript and confirmed chips; chips win over the transcript and conflicts
are flagged, not resolved. Separate discussed / planned / done and client said / therapist said.
Client statements in reported speech ("Klient:in berichtet …"). No adjectives about feelings or
mood; quote the client instead. Other people by role. Short bullet style, past tense for events,
present tense for agreements. No diagnoses, codes, recommendations or risk statements.

## Review screen (`/sessions/:id/report`, de/en)
- Banner "KI-Entwurf – noch nicht geprüft" / "AI draft – not yet reviewed" until approved.
- Transcript left, note right. Click a sentence → its segments highlight; click a segment → the
  sentences that cite it.
- Every `unsupported`, `partly` or `wording` flag must be resolved (keep, edit, delete) before
  approval. Wording check also runs on the therapist's own text (shown, not blocking).
- Therapist-only fields with skippable prompts ("Veränderungen im Befund?", "Suizidalität
  thematisiert?"). Empty stays empty; nothing is written for them.
- Regenerate one AI field; edits are kept per field.
- **Approve** ("Freigeben"): stores approver, time, template and prompt version, AI marker; status
  `approved`; the note becomes read-only. Later changes = **addendum** ("Nachtrag"), a new dated
  version; the old one stays readable.
- Today screen lists unapproved drafts older than 1 day (documentation should be same/next day).
- Without recording or without AI consent: same template, all fields manual.

## Database (additive)
- `reports`: `id`, `session_id` (unique for kind `session_note`), `kind`, `template_code`,
  `template_version`, `status` (`pending` | `drafting` | `draft` | `approved` | `failed` |
  `no_consent`), `draft_enc` (AI output incl. refs/flags), `content_enc` (therapist's current
  text), `llm_model`, `prompt_version`, `failure_reason`, `created_at`, `approved_at`,
  `approved_by`. RLS like transcripts; worker role may write drafts only.
- `report_versions`: `report_id`, `version`, `content_enc`, `created_at`, `created_by`,
  `reason` — append-only (no UPDATE/DELETE grant), version 1 = approval, then addenda.
- `clients.hidden_names_enc` — "names to hide" (ADR 0007).
- The AI draft is kept next to the approved text (shows what the AI wrote vs. what was approved).

## API
`GET /sessions/{id}/report`, `PUT /sessions/{id}/report` (edit draft), `POST …/report/regenerate`
(`field`), `POST …/report/approve`, `POST …/report/addenda`, `GET …/report/versions`.
Errors and states as codes; the browser translates.

## Adapters and settings
- `LlmProvider.draft` becomes structured: `generate_json(system, prompt, schema) -> dict`.
- `GeminiApiProvider` (dev/staging, paid-tier key) and `VertexGeminiProvider` (prod,
  `europe-west4`, no caching, no grounding) + `FakeLlmProvider` for tests. Model via `LLM_MODEL`.
- New dependency (ask): `google-genai` (official SDK for both Gemini API and Vertex), imported only
  in `app/adapters/llm/`.

## Not in this plan
PGP signing, audio crypto-shred, transcript lock into the record (therapist keys step, ADR 0006),
client summary, other templates (VT/TP-specific prompts for "Verständnis"), coverage check
("possibly relevant, not in the note"), data export.

## Tests
- Schema: therapist-only fields can never come from the model (drop + test with a fake model that
  returns them).
- Every stored statement has refs or is flagged; `not_discussed` handled.
- Names replaced before the call (fake provider sees no real names), restored after; genitive -s.
- Wording list flags; approval blocked while flags are open; approval read-only; addendum keeps
  the old version; `report_versions` cannot be updated or deleted (DB role test).
- Consent withdrawn → no draft; job idempotent; failure → `failed` with retry.
- No PHI in logs (existing log test extended).
- Golden set: 5 German + 2 English synthetic role-play transcripts with expected facts, run
  manually against the real model: count invented, missing and negated statements per field.
  Manual: one real role-play on staging.

## Addition (2026-10-09): topics on the session card
The session card (Sessions list, client page) shows the note's `topics` field as one line,
marked "Entwurf" until approved. Same text as in the note — no separate AI summary, so nothing
unchecked and nothing extra in the record. Not shown on Today (screen may be visible to others).
`SessionOut.report_topics`: max 5 items, 80 characters each.
