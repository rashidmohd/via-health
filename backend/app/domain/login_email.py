"""System emails, German and English: the login code (ADR 0003) and the recovery-key check code
(ADR 0017). Codes only — no other data. Plain text plus branded HTML."""

from dataclasses import dataclass
from typing import Literal

from app.domain.email_layout import branded_html

Language = Literal["de", "en"]


@dataclass(frozen=True)
class EmailContent:
    subject: str
    text: str
    html: str


FOOTER = {
    "en": "Sessio · You get this email because of an action in your Sessio account.",
    "de": "Sessio · Sie erhalten diese E-Mail wegen einer Aktion in Ihrem Sessio-Konto.",
}


def login_code_email(code: str, language: Language) -> EmailContent:
    if language == "en":
        valid = "It is valid for 10 minutes. If you did not request it, you can ignore this email."
        return EmailContent(
            subject=f"Your Sessio sign-in code: {code}",
            text=f"Your sign-in code is {code}\n\n{valid}",
            html=branded_html(
                language="en",
                heading="Your sign-in code",
                before=["Enter this code to sign in to Sessio:"],
                code=code,
                after=[valid],
                footer=FOOTER["en"],
            ),
        )
    valid = (
        "Er ist 10 Minuten gültig. Wenn Sie ihn nicht angefordert haben, "
        "können Sie diese E-Mail ignorieren."
    )
    return EmailContent(
        subject=f"Ihr Sessio-Anmeldecode: {code}",
        text=f"Ihr Anmeldecode lautet {code}\n\n{valid}",
        html=branded_html(
            language="de",
            heading="Ihr Anmeldecode",
            before=["Geben Sie diesen Code ein, um sich bei Sessio anzumelden:"],
            code=code,
            after=[valid],
            footer=FOOTER["de"],
        ),
    )


def recovery_check_email(code: str, language: Language) -> EmailContent:
    """The check code of the recovery key — never the key file itself."""
    if language == "en":
        intro = "Type this check code in Sessio to finish setting up your keys:"
        warning = (
            "This email does not replace the recovery key file. Keep the file safe and offline. "
            "If you lose both the file and your passphrase, your signed notes can never be "
            "opened again, not even by Sessio."
        )
        ignore = "If you did not set up keys in Sessio, you can ignore this email."
        return EmailContent(
            subject="Your Sessio recovery key check code",
            text=f"{intro}\n\n{code}\n\n{warning}\n\n{ignore}",
            html=branded_html(
                language="en",
                heading="Recovery key check code",
                before=[intro],
                code=code,
                after=[warning, ignore],
                footer=FOOTER["en"],
            ),
        )
    intro = (
        "Geben Sie diesen Prüfcode in Sessio ein, um die Einrichtung Ihrer Schlüssel abzuschließen:"
    )
    warning = (
        "Diese E-Mail ersetzt nicht die Datei mit dem Wiederherstellungsschlüssel. Bewahren Sie "
        "die Datei sicher und offline auf. Wenn Sie die Datei und Ihre Passphrase verlieren, "
        "können Ihre signierten Notizen nie wieder geöffnet werden, auch nicht von Sessio."
    )
    ignore = (
        "Wenn Sie in Sessio keine Schlüssel eingerichtet haben, können Sie diese E-Mail ignorieren."
    )
    return EmailContent(
        subject="Ihr Sessio-Prüfcode für den Wiederherstellungsschlüssel",
        text=f"{intro}\n\n{code}\n\n{warning}\n\n{ignore}",
        html=branded_html(
            language="de",
            heading="Prüfcode für den Wiederherstellungsschlüssel",
            before=[intro],
            code=code,
            after=[warning, ignore],
            footer=FOOTER["de"],
        ),
    )
