import re
from collections.abc import Callable
from typing import Any

FakeAnswer = Callable[[str, str, dict[str, Any]], dict[str, Any]]


class FakeLlmProvider:
    """Deterministic answers for tests and local development without a key.
    Default: drafts one statement per field from the first transcript line, and marks
    every checked statement as supported."""

    model = "fake"

    def __init__(self, answer: FakeAnswer | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self._answer = answer

    def generate_json(self, *, system: str, prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
        self.calls.append({"system": system, "prompt": prompt, "schema": schema})
        if self._answer is not None:
            return self._answer(system, prompt, schema)
        return default_answer(prompt, schema)


def default_answer(prompt: str, schema: dict[str, Any]) -> dict[str, Any]:
    properties = schema.get("properties", {})
    if "results" in properties:  # support check
        ids = re.findall(r'"id":\s*"([^"]+)"', prompt)
        return {"results": [{"id": i, "support": "supported"} for i in ids]}
    transcript = prompt.split("Transcript:", 1)[-1]
    first = re.search(r"^\[(\d+)\] .*? — (.+)$", transcript, re.MULTILINE)
    fields: dict[str, Any] = {}
    for code in properties:
        if first is None:
            fields[code] = {"status": "not_discussed", "statements": []}
        else:
            text = first.group(2)[:120]
            fields[code] = {
                "status": "content",
                "statements": [
                    {
                        "text": text,
                        "kind": "reported",
                        "refs": [int(first.group(1))],
                        "note_refs": [],
                    }
                ],
            }
    return fields
