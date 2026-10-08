"""Consent status rules (CLAUDE.md rules 8–10). Mirrors client_has_recording_consent() in the DB."""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

ConsentKind = Literal["recording", "ai_processing", "product_improvement"]
ConsentStatus = Literal["granted", "outdated", "withdrawn", "missing"]

CONSENT_KINDS: tuple[ConsentKind, ...] = ("recording", "ai_processing", "product_improvement")
REQUIRED_FOR_RECORDING: tuple[ConsentKind, ...] = ("recording", "ai_processing")


@dataclass(frozen=True)
class ConsentFact:
    kind: ConsentKind
    text_version: int
    withdrawn_at: datetime | None


def consent_status(
    facts: Iterable[ConsentFact], latest_versions: Mapping[str, int]
) -> dict[ConsentKind, ConsentStatus]:
    status: dict[ConsentKind, ConsentStatus] = dict.fromkeys(CONSENT_KINDS, "missing")
    rank = {"missing": 0, "withdrawn": 1, "outdated": 2, "granted": 3}
    for fact in facts:
        if fact.withdrawn_at is not None:
            current: ConsentStatus = "withdrawn"
        elif fact.text_version == latest_versions.get(fact.kind):
            current = "granted"
        else:
            current = "outdated"
        if rank[current] > rank[status[fact.kind]]:
            status[fact.kind] = current
    return status


def ready_to_record(status: Mapping[ConsentKind, ConsentStatus]) -> bool:
    return all(status[kind] == "granted" for kind in REQUIRED_FOR_RECORDING)
