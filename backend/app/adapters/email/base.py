from typing import Protocol


class EmailSender(Protocol):
    def send(self, *, to: str, subject: str, text: str) -> None:
        """Send a plain-text email. Never put PHI in an email."""
        ...
