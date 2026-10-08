"""Login secrets: codes, session tokens and their HMACs. Standard library only."""

import hashlib
import hmac
import secrets

from app.core.config import get_settings

CODE_LENGTH = 6


def keyed_hash(purpose: str, value: str) -> str:
    """HMAC-SHA256 under AUTH_SECRET. `purpose` keeps hashes of different kinds apart."""
    key = get_settings().auth_secret.encode()
    return hmac.new(key, f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def new_code() -> str:
    return f"{secrets.randbelow(10**CODE_LENGTH):0{CODE_LENGTH}d}"


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hashes_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
