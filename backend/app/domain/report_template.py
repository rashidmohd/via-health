"""Session note template `verlauf` v1 (docs/plans/0009-ai-session-report.md).

German "Verlaufsdokumentation" after the BPtK/PTK NRW recommendations. Only the AI fields are
in the model's output schema; therapist-only fields cannot be filled by the model (ADR 0008).
Field labels are UI strings (de/en) in the browser; the backend uses codes only."""

from typing import Any

TEMPLATE_CODE = "verlauf"
TEMPLATE_VERSION = 1
PROMPT_VERSION = "verlauf-1.1"

AI_FIELDS = (
    "homework_followup",
    "current_situation",
    "topics",
    "interventions",
    "agreements",
    "next_session",
)
THERAPIST_FIELDS = ("mental_status", "understanding", "progress", "crisis", "notable")
STATEMENT_KINDS = ("reported", "intervention", "agreement", "plan")
SUPPORT = ("supported", "partly", "unsupported")
SESSION_TYPES = (
    "consultation",  # Sprechstunde
    "probatory",  # Probatorische Sitzung
    "acute",  # Akutbehandlung
    "short_term",  # KZT
    "long_term",  # LZT
    "relapse_prevention",  # Rezidivprophylaxe
    "significant_others",  # Bezugspersonen
    "other",
)
SETTINGS = ("individual", "couple", "family", "group")
MODES = ("in_person", "video")
MAX_STATEMENTS = 8
MAX_STATEMENT_CHARS = 600

FIELD_INSTRUCTIONS = {
    "homework_followup": (
        "What the client reported about tasks or homework agreed in an earlier session. "
        "Only if it was discussed."
    ),
    "current_situation": (
        "Events and circumstances since the last session, as reported by the client "
        "(reported speech)."
    ),
    "topics": "The main topics of this session, in the client's own frame. Two to five items.",
    "interventions": (
        "What the therapist did in the session, described neutrally and concretely, and the "
        "client's verbal response, attributed. Name a method or technique only if the therapist "
        "named it in the session or in a note."
    ),
    "agreements": "Explicit agreements and new tasks, as agreed in the session or in the notes.",
    "next_session": (
        "Only what was explicitly said about the next session or appointment, including "
        "appointment notes."
    ),
}

LANGUAGE_NAMES = {"de": "German", "en": "English"}

SYSTEM_PROMPT = """\
You draft parts of a psychotherapy session note (German "Verlaufsdokumentation") from a session
transcript and the therapist's notes. You are a documentation assistant, not a clinician.
The therapist reviews every sentence.

Rules:
1. Use only what is in the transcript lines and the therapist's notes. Never add facts.
2. Every statement cites its sources: transcript line numbers in `refs`, note numbers in
   `note_refs`. A statement without sources is not allowed.
3. If a field was not discussed, return status "not_discussed" and no statements. Never write
   negative findings that nobody stated.
4. Keep apart what was discussed, what was planned and what was done; and what the client said
   and what the therapist said.
5. Write the client's statements in reported speech ("Klient:in berichtet, ..." /
   "Client reports ...").
6. No diagnoses, no ICD codes, no risk or suicidality statements, no treatment recommendations,
   no clinical assessment. Do not describe or infer feelings, mood or behaviour with adjectives
   (not "wirkte gedrückt", not "seemed anxious"); if it matters, quote the client's own words.
7. Refer to other people only by their role (partner, mother, colleague, boss), never by name.
   Placeholders in square brackets, like [Person 1], stay exactly as they are.
8. Short factual bullet style, one fact per statement, at most 6 statements per field. Past
   tense for events, present tense for agreements.
9. Write the statements in {language}.
"""

UNKNOWN_SPEAKERS_NOTE = (
    "Speaker roles are not confirmed: one speaker is the therapist, the other the client. "
    "Decide from context (who asks, who gives tasks)."
)

CHECK_SYSTEM_PROMPT = """\
You check statements of a draft session note against their sources. For each statement answer:
- "supported": everything in the statement is stated in its sources;
- "partly": part is stated, but it adds detail, interpretation or a different emphasis;
- "unsupported": not stated, or contradicts the sources.
Be strict about negations, numbers, times, and who said what. Judge only the given sources.
"""


def draft_schema(fields: tuple[str, ...]) -> dict[str, Any]:
    statement = {
        "type": "object",
        "properties": {
            "text": {"type": "string"},
            "kind": {"type": "string", "enum": list(STATEMENT_KINDS)},
            "refs": {"type": "array", "items": {"type": "integer"}},
            "note_refs": {"type": "array", "items": {"type": "integer"}},
        },
        "required": ["text", "kind", "refs", "note_refs"],
    }
    field = {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["content", "not_discussed"]},
            "statements": {"type": "array", "items": statement},
        },
        "required": ["status", "statements"],
    }
    assert not set(fields) & set(THERAPIST_FIELDS), "therapist-only fields never go to the model"
    return {
        "type": "object",
        "properties": {code: field for code in fields},
        "required": list(fields),
    }


CHECK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "support": {"type": "string", "enum": list(SUPPORT)},
                },
                "required": ["id", "support"],
            },
        }
    },
    "required": ["results"],
}
