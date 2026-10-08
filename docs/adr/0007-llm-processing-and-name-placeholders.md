# 0007 — LLM processing in plain text, names replaced by placeholders

Status: accepted (2026-10-08)

## Context
The BPtK Praxis-Info "Administrative KI" (May 2026) expects data to be anonymised or encrypted
against the cloud provider. A language model needs plain text while it works, so end-to-end
encryption is not possible for the drafting step.

## Decision
- Data is **encrypted at rest and in transit**; it is plain text only **in memory** at the
  worker and at Vertex AI while the draft is made.
- Vertex AI in the EU (`europe-west4`), caching disabled, no grounding, abuse-monitoring
  exception requested for zero retention (CLAUDE.md rules 4, 5; ADR 0005 for dev).
- **Names are replaced before the LLM call** and put back after it:
  - known names: the client's names, the therapist's names, and a per-client list
    "names to hide" that the therapist can fill (e.g. partner, children, employer);
  - matched case-insensitively, whole words, including German genitive "-s";
  - placeholders `[Klient:in]`, `[Therapeut:in]`, `[Person 1]`, `[Person 2]` … (EN:
    `[Client]`, `[Therapist]`, `[Person 1]`);
  - the worker puts the names back before storing the draft encrypted.
- The prompt also tells the model to name other people by role ("Partner", "Mutter").

## Consequences
- Unknown names (not in any list) still reach the model. We do not run name detection, because
  sending text to another service to find names would defeat the purpose.
- The worker sees the name list in memory. It already sees the plain transcript, so this adds no
  new exposure; the list is stored encrypted like client data (ADR 0004).
- The DPIA must describe this explicitly (lawyer review).
