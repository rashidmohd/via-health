# 0002 — Placeholder consent texts for the prototype

Status: accepted (2026-10-08)

## Context
Final consent wording is pending lawyer review. The prototype still needs consent records to enforce
"no recording without consent" (rules 8–10).

## Decision
Seed versioned placeholder texts (`version = 0`, German and English) for `recording`, `ai_processing`
and `product_improvement`. Each text starts with "PROTOTYP – nicht rechtlich geprüft" / "PROTOTYPE – not legally reviewed".

## Consequences
Enforcement works end to end now. When the lawyer-approved texts arrive they are published as version 1;
because a new version requires re-consent, every client signs again before their next recording.
Placeholder texts must never be used with real clients.
