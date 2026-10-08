# 0008 — The AI documents what was said and done; it never assesses

Status: accepted (2026-10-08)

## Context
Software that suggests diagnoses, ICD codes, treatments or risk levels is usually a class IIa
medical device (MDR Rule 11, MDCG 2019-11) and high-risk under the AI Act. The BPtK counts
transcription and documentation as "administrative KI". The best scribe study (Asgari et al.
2025) found most serious errors in assessment and plan sections. CLAUDE.md rules 11–13.

## Decision
Allowed — the AI may:
- draft note fields from what was said in the session, with a link to the transcript;
- write "nicht besprochen" / "not discussed" for empty fields;
- pre-fill codes or facts **the therapist entered** (e.g. an ICD code from the client record);
- show skippable reminders for therapist-only fields ("Changes in mental status?").

Not allowed — the AI never:
- suggests diagnoses or ICD codes, treatments or next interventions;
- produces risk or suicidality statements or scores;
- describes or infers emotions or mood ("wirkte gedrückt");
- fills the fields mental status, clinical understanding, treatment progress, suicidality/crisis.

These fields are **not in the model's output schema**, so the model cannot fill them even if
the prompt fails. Product and help texts say "Dokumentationsentwurf" (documentation draft),
never "Einschätzung" (assessment).

## Consequences
- Keeps the product outside MDR and AI Act high-risk; AI Act duties left: tell users and
  clients that AI drafts the note (Art. 50) and give AI-literacy material (Art. 4).
- Replaces the "optional ICD suggestions later" note in the `report-generation` skill: dropped.
- Therapists write the clinical fields themselves; the app makes that fast but never pre-fills.
