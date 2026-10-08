from app.adapters.email.base import EmailSender
from app.adapters.email.console import ConsoleEmailSender
from app.adapters.email.resend import EmailSendError, ResendEmailSender
from app.core.config import get_settings


def get_email_sender() -> EmailSender:
    settings = get_settings()
    if settings.email_sender == "resend":
        return ResendEmailSender(api_key=settings.resend_api_key, sender=settings.email_from)
    return ConsoleEmailSender()


__all__ = ["EmailSendError", "EmailSender", "get_email_sender"]
