"""Shared helpers for API tests (fixtures live in conftest.py)."""

import re
from dataclasses import dataclass, field
from typing import Any

from fastapi.testclient import TestClient

from app.adapters.email import EmailSendError
from app.core.config import get_settings

ORIGIN = get_settings().web_origin
PNG = "data:image/png;base64,iVBORw0KGgo="


@dataclass
class FakeEmailSender:
    sent: list[tuple[str, str, str]] = field(default_factory=list)
    html: list[str | None] = field(default_factory=list)
    fail: bool = False

    def send(self, *, to: str, subject: str, text: str, html: str | None = None) -> None:
        if self.fail:
            raise EmailSendError("down")
        self.sent.append((to, subject, text))
        self.html.append(html)

    def last_code(self) -> str:
        match = re.search(r"\b(\d{6})\b", self.sent[-1][2])
        assert match
        return match.group(1)


def start(client: TestClient, email: str, language: str = "en") -> int:
    return client.post("/auth/email/start", json={"email": email, "language": language}).status_code


def login(client: TestClient, mail: FakeEmailSender, email: str, **extra: str) -> dict[str, str]:
    assert start(client, email) == 202
    response = client.post(
        "/auth/email/verify", json={"email": email, "code": mail.last_code(), **extra}
    )
    assert response.status_code == 200, response.text
    body: dict[str, str] = response.json()
    return body


# --- therapist keys and signing (plan 0014) --------------------------------------------
# The server never parses OpenPGP data, so armored placeholders stand in for real keys and
# messages (the browser tests cover the real cryptography).


def armored(kind: str, body: str = "xjMEZ") -> str:
    return f"-----BEGIN PGP {kind}-----\n\n{body}\n-----END PGP {kind}-----\n"


THERAPIST_FP = "a" * 64
RECOVERY_FP = "b" * 64
KEYS = {
    "therapist_public_key": armored("PUBLIC KEY BLOCK", "therapist"),
    "therapist_private_key": armored("PRIVATE KEY BLOCK", "therapist-locked"),
    "recovery_public_key": armored("PUBLIC KEY BLOCK", "recovery"),
    "therapist_fingerprint": THERAPIST_FP,
    "recovery_fingerprint": RECOVERY_FP,
}
SIGNED_BY = {"signer_fingerprint": THERAPIST_FP, "encrypted_to": [THERAPIST_FP, RECOVERY_FP]}


def message(body: str) -> str:
    return armored("MESSAGE", body)


def sign_body(prepared: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """What the browser sends after signing what `sign/prepare` returned."""
    body: dict[str, Any] = {
        "note": message("note"),
        "transcript": message("transcript") if prepared["transcript"] is not None else None,
        "index": message("index"),
        "addenda": [
            {"version": a["version"], "message": message(f"addendum-{a['version']}")}
            for a in prepared["addenda"]
        ],
        "approved_at": prepared["approved_at"],
        "report_updated_at": prepared["report_updated_at"],
        **SIGNED_BY,
    }
    body.update(changes)
    return body


def sign_note(client: TestClient, session_id: str) -> dict[str, Any]:
    prepared = client.post(f"/sessions/{session_id}/report/sign/prepare")
    assert prepared.status_code == 200, prepared.text
    response = client.post(f"/sessions/{session_id}/report/sign", json=sign_body(prepared.json()))
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result
