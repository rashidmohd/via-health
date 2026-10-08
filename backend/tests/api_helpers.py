"""Shared helpers for API tests (fixtures live in conftest.py)."""

import re
from dataclasses import dataclass, field

from fastapi.testclient import TestClient

from app.adapters.email import EmailSendError
from app.core.config import get_settings

ORIGIN = get_settings().web_origin
PNG = "data:image/png;base64,iVBORw0KGgo="


@dataclass
class FakeEmailSender:
    sent: list[tuple[str, str, str]] = field(default_factory=list)
    fail: bool = False

    def send(self, *, to: str, subject: str, text: str) -> None:
        if self.fail:
            raise EmailSendError("down")
        self.sent.append((to, subject, text))

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
