import logging

import httpx2

logger = logging.getLogger("sessio.email")

RESEND_URL = "https://api.resend.com/emails"


class EmailSendError(Exception):
    pass


class ResendEmailSender:
    """Resend over HTTPS. The sending domain must be created in region eu-west-1 (ADR 0003)."""

    def __init__(self, *, api_key: str, sender: str) -> None:
        self._api_key = api_key
        self._sender = sender

    def send(self, *, to: str, subject: str, text: str) -> None:
        try:
            response = httpx2.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"from": self._sender, "to": [to], "subject": subject, "text": text},
                timeout=10,
            )
        except httpx2.HTTPError as exc:
            # Do not include the response body or recipient: keep logs free of personal data.
            logger.error("Resend request failed: %s", type(exc).__name__)
            raise EmailSendError(type(exc).__name__) from None
        if response.is_error:
            # Status and Resend's error name only: the message can contain the recipient.
            try:
                name = response.json().get("name", "")
            except ValueError:
                name = ""
            logger.error("Resend rejected the email: HTTP %s %s", response.status_code, name)
            raise EmailSendError(f"HTTP {response.status_code}")
