import httpx2

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
            response.raise_for_status()
        except httpx2.HTTPError as exc:
            # Do not include the response body or recipient: keep logs free of personal data.
            raise EmailSendError(type(exc).__name__) from None
