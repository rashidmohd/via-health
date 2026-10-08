"""Login code email, German and English. Only the code — no other data."""

from dataclasses import dataclass
from typing import Literal

Language = Literal["de", "en"]


@dataclass(frozen=True)
class EmailContent:
    subject: str
    text: str


def login_code_email(code: str, language: Language) -> EmailContent:
    if language == "en":
        return EmailContent(
            subject=f"Your Sessio sign-in code: {code}",
            text=(
                f"Your sign-in code is {code}\n\n"
                "It is valid for 10 minutes. If you did not request it, you can ignore this email."
            ),
        )
    return EmailContent(
        subject=f"Ihr Sessio-Anmeldecode: {code}",
        text=(
            f"Ihr Anmeldecode lautet {code}\n\n"
            "Er ist 10 Minuten gültig. Wenn Sie ihn nicht angefordert haben, "
            "können Sie diese E-Mail ignorieren."
        ),
    )
