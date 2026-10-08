# 0005 — Gemini API for development, Vertex AI (EU) for production

Status: accepted (2026-10-08)

## Context
Report drafting uses Gemini. Vertex AI (`europe-west4`) gives EU processing and zero data
retention but needs more setup. The Gemini Developer API (Google AI Studio) only needs an API key.

## Decision
- `LLM_PROVIDER=gemini_api` is allowed in **dev and staging** (hosted test environment, `APP_ENV=staging`) only, with **test data only** and an API key on
  the **paid tier** (free-tier prompts may be used by Google and reviewed by humans).
- `LLM_PROVIDER=vertex` (EU region) is required in **prod**; the API refuses to start otherwise.
- Both sit behind the `LlmProvider` adapter; switching is configuration only.
- Transcription stays on Speech-to-Text Chirp 3 in the EU in all environments.

## Consequences
- In dev, CLAUDE.md rules 4 (EU only) and 5 (Google data settings) are knowingly not met for
  report prompts. Acceptable only because dev never holds real client data.
- Before production: Vertex setup, abuse-monitoring exception (zero retention), DPA.
