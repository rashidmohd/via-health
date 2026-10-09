from typing import Protocol


class EmailSender(Protocol):
    def send(self, *, to: str, subject: str, text: str, html: str | None = None) -> None:
        """Send an email: plain text, plus an HTML version if given. Never put PHI in an email."""
        ...
