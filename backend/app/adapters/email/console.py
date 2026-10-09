import logging

logger = logging.getLogger("sessio.email")


class ConsoleEmailSender:
    """Dev only: prints the email body (the login code) to the server log."""

    def send(self, *, to: str, subject: str, text: str, html: str | None = None) -> None:
        logger.info("dev email: %s\n%s", subject, text)
