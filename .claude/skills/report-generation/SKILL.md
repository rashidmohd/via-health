---
name: report-generation
description: Use when working on report templates (SOAP, DAP, intake, progress, discharge), the LlmProvider/Gemini adapter, prompts, the therapist review and sign flow, or client-facing documents (consent copy, session summary, data export).
---

# Report generation

The LLM drafts; the therapist decides. Output is documentation, never clinical judgement.

## Report types

For the user (therapist):
| Kind | When | Priority |
|---|---|---|
| `session_note` | after every session; template SOAP / DAP / free-form | 1 |
| `progress` | on demand, across sessions | 2 |
| `intake` | first sessions | 3 |
| `discharge` | end of therapy | 3 |

For the client (always therapist-approved, never automatic):
| Kind | Notes |
|---|---|
| `consent_copy` | automatic after signing consent (not AI-generated) |
| `client_summary` | plain language: topics, agreed exercises, next appointment. No diagnoses or clinical assessments |
| `data_export` | on request, from signed records, with a redaction step (§630g BGB) |

Insurance reports (e.g. Gutachten) are out of scope for the prototype.

## Templates

`report_templates.structure` is JSON describing sections, e.g. SOAP:
```json
{"sections":[
  {"key":"subjective","title":"Subjektiv","instructions":"What the client reported, in their words where useful."},
  {"key":"objective","title":"Objektiv","instructions":"Observable facts from the session only."},
  {"key":"assessment","title":"Einschätzung","instructions":"Leave as a placeholder for the therapist. Do not write an assessment."},
  {"key":"plan","title":"Plan","instructions":"Agreed next steps and exercises as stated in the session."}
]}
```

## Adapter

```python
class LlmProvider(Protocol):
    async def draft(self, *, template: Template, transcript: list[Segment],
                    captures: list[Capture], language: str) -> DraftReport: ...
```
Implementations: `VertexGeminiProvider` (`europe-west4`, caching disabled, no grounding) and `FakeLlmProvider` for tests. Use structured output (JSON schema = template sections). Low temperature.

## Prompt rules (system prompt, versioned in code)

- Use only content present in the transcript and confirmed captures. If something is not in the transcript, leave the section empty or "Nicht besprochen".
- No diagnoses, ICD codes, risk assessments, treatment recommendations, or interpretation of the client's emotions/mental state. (Optional ICD suggestions are a later, separately reviewed feature.)
- Replace names with placeholders (`[Klient]`, `[Person 1]`) before sending to the LLM; re-insert in the browser after decryption.
- Every statement should be traceable: return `source_segments` (segment indices) per sentence so the review UI can highlight evidence.
- Write in the language of the session unless the template says otherwise.

## Review and sign flow

1. Draft stored encrypted with the session key (`reports.draft_enc`), status `draft`.
2. Review screen: transcript left (speaker labels editable: S1 → Therapeut, S2 → Klient), draft right, click a sentence to see its source segments, confirmed captures listed.
3. Therapist edits freely; regenerate per section allowed.
4. "Sign" → see `encryption-and-keys` (PGP sign + encrypt, crypto-shred, delete draft).
5. "Reject" → delete draft, keep session for manual note.

## Client document delivery

One-time download link + code sent separately (e.g. SMS). Token stored hashed, expires (default 7 days), single use, download audited. Never attach PHI to plain email.

## Tests

Golden tests with fixture transcripts per template: no invented facts (every sentence has sources), assessment section stays empty, names replaced, German output for German input.
