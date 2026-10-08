"""Building the model input and checking its output for a session note (plan 0009).

- Names are replaced by placeholders before the model call and restored after (ADR 0007).
- Model output is validated field by field; unknown and therapist-only fields are dropped.
- A fixed word list flags judgmental or emotion words for the therapist (ADR 0008)."""

import json
import re
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.domain.report_template import (
    AI_FIELDS,
    FIELD_INSTRUCTIONS,
    LANGUAGE_NAMES,
    MAX_STATEMENT_CHARS,
    MAX_STATEMENTS,
    STATEMENT_KINDS,
    SUPPORT,
    SYSTEM_PROMPT,
    THERAPIST_FIELDS,
    UNKNOWN_SPEAKERS_NOTE,
)
from app.domain.transcript import Segment

# --- names (ADR 0007) -------------------------------------------------------------------

PLACEHOLDERS = {
    "de": {"client": "[Klient:in]", "therapist": "[Therapeut:in]", "person": "[Person {n}]"},
    "en": {"client": "[Client]", "therapist": "[Therapist]", "person": "[Person {n}]"},
}
# Name parts that are also ordinary words; matched only as part of the full name.
NAME_PARTICLES = {"von", "van", "der", "den", "de", "del", "la", "le", "zu", "und", "dr", "prof"}
MIN_PART_CHARS = 3


@dataclass(frozen=True)
class NameList:
    client: list[str] = field(default_factory=list)
    therapist: list[str] = field(default_factory=list)
    others: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, list[str]]:
        return {"client": self.client, "therapist": self.therapist, "others": self.others}

    @classmethod
    def from_json(cls, value: dict[str, Any]) -> "NameList":
        return cls(
            client=[str(v) for v in value.get("client", [])],
            therapist=[str(v) for v in value.get("therapist", [])],
            others=[str(v) for v in value.get("others", [])],
        )


class NameMasker:
    """Replaces known names (full name and each name part) with placeholders, whole words,
    case-insensitive, also with a German genitive -s. `restore` puts the full names back."""

    def __init__(self, names: NameList, language: str) -> None:
        marks = PLACEHOLDERS.get(language, PLACEHOLDERS["de"])
        groups: list[tuple[str, str]] = [(n, marks["client"]) for n in names.client[:1]]
        groups += [(n, marks["client"]) for n in names.client[1:]]
        groups += [(n, marks["therapist"]) for n in names.therapist]
        groups += [(n, marks["person"].format(n=i)) for i, n in enumerate(names.others, start=1)]
        self._term_to_mark: dict[str, str] = {}
        self._mark_to_name: dict[str, str] = {}
        for name, mark in groups:
            name = " ".join(name.split())
            if not name:
                continue
            self._mark_to_name.setdefault(mark, name)
            terms = [name] + [
                part
                for part in re.split(r"[\s\-]+", name)
                if len(part) >= MIN_PART_CHARS and part.lower().strip(".") not in NAME_PARTICLES
            ]
            for term in terms:
                self._term_to_mark.setdefault(term.lower(), mark)
        terms_by_length = sorted(self._term_to_mark, key=len, reverse=True)
        self._pattern = (
            re.compile(
                r"(?<!\w)(" + "|".join(re.escape(t) for t in terms_by_length) + r")s?(?!\w)",
                re.IGNORECASE,
            )
            if terms_by_length
            else None
        )

    def mask(self, text: str) -> str:
        if self._pattern is None:
            return text
        return self._pattern.sub(lambda m: self._term_to_mark[m.group(1).lower()], text)

    def restore(self, text: str) -> str:
        for mark, name in self._mark_to_name.items():
            text = text.replace(mark, name)
        return text


# --- wording check ----------------------------------------------------------------------

WORDING = re.compile(
    r"(?<!\w)("
    # German
    r"wirkte?|wirken|schien|scheint|verweiger\w*|manipulativ\w*|behaupte\w*|uneinsichtig\w*|"
    r"unkooperativ\w*|aggressiv\w*|hysterisch\w*|theatralisch\w*|querulatorisch\w*|"
    r"angeblich\w*|traurig\w*|wütend\w*|ängstlich\w*|depressiv\w*|gedrückt\w*|"
    r"niedergeschlagen\w*|euphorisch\w*|labil\w*|gereizt\w*|"
    # English
    r"seemed|seems|appeared|refus\w*|manipulat\w*|claim\w*|alleged\w*|non-?compliant|"
    r"uncooperative|hysterical|dramatic|tearful|sad|angry|anxious|depressed|agitated|irritable"
    r")(?!\w)",
    re.IGNORECASE,
)


def wording_hits(text: str) -> list[str]:
    """Judgmental or emotion words. Shown to the therapist; never changes text."""
    hits: list[str] = []
    for match in WORDING.finditer(text):
        word = match.group(1).lower()
        if word not in hits:
            hits.append(word)
    return hits


# --- model input --------------------------------------------------------------------------


@dataclass(frozen=True)
class Note:
    """A confirmed capture chip (task, appointment, term, bookmark) with its text."""

    id: str
    kind: str
    at_ms: int
    text: str


SPEAKER_NAMES = {
    "de": {"therapist": "Therapeut:in", "client": "Klient:in", "speaker": "Sprecher {label}"},
    "en": {"therapist": "Therapist", "client": "Client", "speaker": "Speaker {label}"},
}
NOTE_KINDS = {
    "de": {"action_item": "Aufgabe", "date": "Termin", "term": "Begriff", "bookmark": "Markierung"},
    "en": {"action_item": "Task", "date": "Appointment", "term": "Term", "bookmark": "Bookmark"},
}


def _clock(ms: int) -> str:
    seconds = ms // 1000
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def speaker_name(label: str | None, therapist_label: str | None, language: str) -> str:
    names = SPEAKER_NAMES.get(language, SPEAKER_NAMES["de"])
    if therapist_label is not None and label is not None:
        return names["therapist"] if label == therapist_label else names["client"]
    return names["speaker"].format(label=label or "?")


def build_prompt(
    *,
    segments: Sequence[Segment],
    notes: Sequence[Note],
    therapist_label: str | None,
    language: str,
    fields: Sequence[str],
    mask: Callable[[str], str],
) -> tuple[str, str]:
    """System prompt and user prompt. Transcript lines are numbered [0]..; notes [1]..."""
    system = SYSTEM_PROMPT.format(language=LANGUAGE_NAMES.get(language, "German"))
    if therapist_label is None:
        system += "\n" + UNKNOWN_SPEAKERS_NOTE + "\n"
    kinds = NOTE_KINDS.get(language, NOTE_KINDS["de"])
    parts = ["Fields to fill:"]
    parts += [f"- {code}: {FIELD_INSTRUCTIONS[code]}" for code in fields]
    parts.append("")
    parts.append("Therapist notes:")
    if notes:
        parts += [
            f"[{i}] ({_clock(n.at_ms)}) {kinds.get(n.kind, n.kind)}: {mask(n.text) or '-'}"
            for i, n in enumerate(notes, start=1)
        ]
    else:
        parts.append("(none)")
    parts.append("")
    parts.append("Transcript:")
    parts += [
        f"[{i}] ({_clock(s.start_ms)}) "
        f"{speaker_name(s.speaker, therapist_label, language)} — {mask(s.text)}"
        for i, s in enumerate(segments)
    ]
    return system, "\n".join(parts)


# --- model output -------------------------------------------------------------------------


def _ints(value: Any, upper: int) -> list[int]:
    if not isinstance(value, list):
        return []
    seen: list[int] = []
    for item in value:
        if isinstance(item, int) and not isinstance(item, bool) and 0 <= item < upper:
            if item not in seen:
                seen.append(item)
    return seen


def parse_draft(
    raw: dict[str, Any],
    *,
    fields: Sequence[str],
    segments: Sequence[Segment],
    notes: Sequence[Note],
    restore: Callable[[str], str],
) -> dict[str, dict[str, Any]]:
    """Validated fields: `{code: {status, statements: [...]}}`. Only `fields` are read, so a
    therapist-only field in the output is ignored. Sources become times (transcript) and
    note ids, which survive later speaker corrections."""
    result: dict[str, dict[str, Any]] = {}
    for code in fields:
        value = raw.get(code)
        statements: list[dict[str, Any]] = []
        raw_statements = value.get("statements") if isinstance(value, dict) else None
        for item in raw_statements if isinstance(raw_statements, list) else []:
            if not isinstance(item, dict) or not isinstance(item.get("text"), str):
                continue
            text = " ".join(item["text"].split())[:MAX_STATEMENT_CHARS]
            if not text:
                continue
            kind = item.get("kind") if item.get("kind") in STATEMENT_KINDS else "reported"
            lines = _ints(item.get("refs"), len(segments))
            note_numbers = [n - 1 for n in _ints(item.get("note_refs"), len(notes) + 1) if n > 0]
            text = restore(text)
            statements.append(
                {
                    "id": uuid.uuid4().hex[:12],
                    "text": text,
                    "kind": kind,
                    "refs": [[segments[i].start_ms, segments[i].end_ms] for i in lines],
                    "notes": [notes[n].id for n in note_numbers],
                    "lines": lines,  # only for the check call; removed before storing
                    "note_numbers": note_numbers,
                    "support": "unsupported",
                    "ai_wording": wording_hits(text),
                    "origin": "ai",
                    "resolved": False,
                }
            )
            if len(statements) >= MAX_STATEMENTS:
                break
        result[code] = {
            "status": "content" if statements else "not_discussed",
            "statements": statements,
        }
    return result


def check_prompt(
    fields: dict[str, dict[str, Any]],
    *,
    segments: Sequence[Segment],
    notes: Sequence[Note],
    therapist_label: str | None,
    language: str,
    mask: Callable[[str], str],
) -> str | None:
    """Statements with their cited sources, for the support check. None if nothing to check."""
    items = []
    for value in fields.values():
        for statement in value["statements"]:
            sources = [
                f"{speaker_name(segments[i].speaker, therapist_label, language)}: "
                f"{mask(segments[i].text)}"
                for i in statement["lines"]
            ] + [f"Note: {mask(notes[n].text)}" for n in statement["note_numbers"]]
            if sources:
                items.append(
                    {"id": statement["id"], "text": mask(statement["text"]), "sources": sources}
                )
    if not items:
        return None
    return json.dumps(items, ensure_ascii=False, indent=1)


def apply_check(fields: dict[str, dict[str, Any]], raw: dict[str, Any]) -> None:
    """Set `support` per statement. Missing or invalid answers stay `unsupported`."""
    answers: dict[str, str] = {}
    results = raw.get("results")
    for item in results if isinstance(results, list) else []:
        if isinstance(item, dict) and item.get("support") in SUPPORT:
            answers[str(item.get("id"))] = item["support"]
    for value in fields.values():
        for statement in value["statements"]:
            if statement["lines"] or statement["note_numbers"]:
                statement["support"] = answers.get(statement["id"], "unsupported")
            statement.pop("lines")
            statement.pop("note_numbers")


def is_blocking(statement: dict[str, Any]) -> bool:
    """An AI statement that must be kept, edited or deleted explicitly before approval."""
    return (
        statement.get("origin") == "ai"
        and not statement.get("resolved")
        and (statement.get("support") != "supported" or bool(statement.get("ai_wording")))
    )


def empty_ai_fields() -> dict[str, dict[str, Any]]:
    return {code: {"status": "not_discussed", "statements": []} for code in AI_FIELDS}


def report_aad(report_id: uuid.UUID, part: str) -> str:
    return f"report:{report_id}:{part}"


def names_aad(session_id: uuid.UUID) -> str:
    return f"session:{session_id}:llm-names"


def default_content() -> dict[str, Any]:
    return {
        "header": {
            "session_type": None,
            "session_no": None,
            "setting": "individual",
            "mode": "in_person",
            "attendees_extra": "",
            "location": "",
        },
        "ai": empty_ai_fields(),
        "therapist": dict.fromkeys(THERAPIST_FIELDS, ""),
    }
