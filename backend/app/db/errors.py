"""Stable error codes raised by DB triggers. The API returns these codes;
the web app translates them (de/en)."""

from sqlalchemy.exc import DBAPIError

DB_ERROR_CODES = frozenset(
    {
        "client_not_found",
        "client_not_active",
        "consent_missing",
        "consent_text_kind_mismatch",
        "consent_invalid",
        "consent_immutable",
        "session_not_found",
        "audio_not_accepted",
        "chunk_conflict",
        "consent_texts_immutable",
        "audit_log_immutable",
    }
)


def db_error_code(exc: DBAPIError) -> str | None:
    diag = getattr(exc.orig, "diag", None)
    message = getattr(diag, "message_primary", None)
    return message if message in DB_ERROR_CODES else None
