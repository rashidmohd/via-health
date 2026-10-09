"""Therapist and recovery keys (plan 0014 step A)."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError

from app.db.errors import db_error_code
from tests.api_helpers import FakeEmailSender, login


def armored(kind: str, body: str = "xjMEZ") -> str:
    return f"-----BEGIN PGP {kind} KEY BLOCK-----\n\n{body}\n-----END PGP {kind} KEY BLOCK-----\n"


KEYS = {
    "therapist_public_key": armored("PUBLIC", "therapist"),
    "therapist_private_key": armored("PRIVATE", "therapist-locked"),
    "recovery_public_key": armored("PUBLIC", "recovery"),
    "therapist_fingerprint": "a" * 64,
    "recovery_fingerprint": "b" * 64,
}


def test_no_keys_yet(client: TestClient, mail: FakeEmailSender) -> None:
    me = login(client, mail, "anna@example.com")
    assert me["has_keys"] is False
    response = client.get("/keys")
    assert response.status_code == 404
    assert response.json() == {"code": "keys_missing"}


def test_keys_stored_and_read_back(
    client: TestClient, mail: FakeEmailSender, owner: Engine
) -> None:
    me = login(client, mail, "anna@example.com")
    response = client.put("/keys", json=KEYS)
    assert response.status_code == 201
    assert response.json() == KEYS
    assert client.get("/keys").json() == KEYS
    assert client.get("/auth/me").json()["has_keys"] is True

    with owner.connect() as c:
        actions = c.execute(text("SELECT action FROM audit_log ORDER BY id")).scalars().all()
        fingerprints = c.execute(
            text("SELECT key_fingerprints FROM users WHERE id = :id"), {"id": me["id"]}
        ).scalar_one()
    assert "keys_created" in actions
    assert fingerprints == {"therapist": "a" * 64, "recovery": "b" * 64}


def test_keys_set_only_once(client: TestClient, mail: FakeEmailSender) -> None:
    login(client, mail, "anna@example.com")
    assert client.put("/keys", json=KEYS).status_code == 201
    again = client.put("/keys", json={**KEYS, "therapist_fingerprint": "c" * 64})
    assert again.status_code == 409
    assert again.json() == {"code": "keys_exist"}
    assert client.get("/keys").json()["therapist_fingerprint"] == "a" * 64


@pytest.mark.parametrize(
    "change",
    [
        {"recovery_public_key": armored("PRIVATE", "recovery-secret")},
        {"therapist_public_key": armored("PRIVATE")},
        {"therapist_private_key": armored("PUBLIC")},
        {"therapist_public_key": "not a key"},
        {"therapist_fingerprint": "A" * 64},
        {"recovery_fingerprint": "b" * 40},
        {"recovery_fingerprint": "a" * 64},
        {"therapist_private_key": armored("PRIVATE", "x" * 20_000)},
    ],
    ids=[
        "recovery-private-key",
        "private-as-public",
        "public-as-private",
        "not-armored",
        "upper-case-fingerprint",
        "v4-fingerprint",
        "same-key-twice",
        "too-large",
    ],
)
def test_bad_keys_rejected(
    client: TestClient, mail: FakeEmailSender, change: dict[str, str]
) -> None:
    login(client, mail, "anna@example.com")
    response = client.put("/keys", json={**KEYS, **change})
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_input"}  # no key data echoed back
    assert client.get("/keys").status_code == 404


def test_keys_need_login(client: TestClient) -> None:
    assert client.get("/keys").status_code == 401
    assert client.put("/keys", json=KEYS).status_code == 401


def test_other_therapist_sees_own_keys_only(client: TestClient, mail: FakeEmailSender) -> None:
    login(client, mail, "anna@example.com")
    client.put("/keys", json=KEYS)
    client.post("/auth/logout")
    login(client, mail, "ben@example.com")
    assert client.get("/keys").status_code == 404


def _set(c: object, user_id: str, sql: str) -> None:
    c.execute(text(f"UPDATE users SET {sql} WHERE id = :id"), {"id": user_id})  # type: ignore[attr-defined]


def test_db_keeps_keys_write_once_and_complete(
    client: TestClient, mail: FakeEmailSender, owner: Engine
) -> None:
    """Even the table owner cannot replace stored keys or store half a key set."""
    first = login(client, mail, "anna@example.com")
    client.put("/keys", json=KEYS)
    client.post("/auth/logout")
    second = login(client, mail, "ben@example.com")

    with owner.connect() as c:
        with pytest.raises(DBAPIError) as info:
            _set(c, first["id"], "pgp_public_key = 'other'")
        assert db_error_code(info.value) == "keys_immutable"
        c.rollback()
        with pytest.raises(DBAPIError) as info:
            _set(c, first["id"], "pgp_public_key = NULL")
        assert db_error_code(info.value) == "keys_immutable"
        c.rollback()
        with pytest.raises(DBAPIError, match="keys_complete"):
            _set(c, second["id"], "pgp_public_key = 'only this'")
        c.rollback()
        # Other columns of a user with keys can still change.
        _set(c, first["id"], "display_name = 'Anna B.'")
        c.commit()
    assert uuid.UUID(first["id"])


# --- check code by email (ADR 0017) ---------------------------------------------------


def test_check_code_emailed_with_consent(
    client: TestClient, mail: FakeEmailSender, owner: Engine
) -> None:
    login(client, mail, "anna@example.com")
    client.patch("/auth/me", json={"ui_language": "en"})
    response = client.post(
        "/keys/check-code-email", json={"check_code": "AB12-CD34", "consent": True}
    )
    assert response.status_code == 202
    to, subject, body = mail.sent[-1]
    assert to == "anna@example.com"
    assert subject == "Your Sessio recovery key check code"
    assert "AB12-CD34" in body
    assert "does not replace the recovery key file" in body
    html = mail.html[-1]
    assert html is not None and "AB12-CD34" in html and "/email/sessio-logo.png" in html
    assert "PRIVATE KEY" not in body + html
    with owner.connect() as c:
        meta = c.execute(
            text("SELECT meta FROM audit_log WHERE action = 'check_code_emailed'")
        ).scalar_one()
    assert meta == {"consent": True}


@pytest.mark.parametrize(
    "body",
    [
        {"check_code": "AB12-CD34", "consent": False},
        {"check_code": "AB12-CD34"},
        {"check_code": "ab12-cd34", "consent": True},
        {"check_code": "<b>AB12</b>", "consent": True},
    ],
    ids=["no-consent", "consent-missing", "lower-case", "markup"],
)
def test_check_code_email_needs_consent_and_a_code(
    client: TestClient, mail: FakeEmailSender, body: dict[str, object]
) -> None:
    login(client, mail, "anna@example.com")
    sent = len(mail.sent)
    assert client.post("/keys/check-code-email", json=body).status_code == 422
    assert len(mail.sent) == sent


def test_check_code_email_only_during_setup_and_limited(
    client: TestClient, mail: FakeEmailSender
) -> None:
    login(client, mail, "anna@example.com")
    body = {"check_code": "AB12-CD34", "consent": True}
    for _ in range(3):
        assert client.post("/keys/check-code-email", json=body).status_code == 202
    limited = client.post("/keys/check-code-email", json=body)
    assert limited.status_code == 429
    assert limited.json() == {"code": "too_many_requests"}

    client.put("/keys", json=KEYS)
    done = client.post("/keys/check-code-email", json=body)
    assert done.status_code == 409
    assert done.json() == {"code": "keys_exist"}


def test_check_code_email_in_german_and_send_failure(
    client: TestClient, mail: FakeEmailSender
) -> None:
    login(client, mail, "anna@example.com")
    client.patch("/auth/me", json={"ui_language": "de"})
    body = {"check_code": "AB12-CD34", "consent": True}
    client.post("/keys/check-code-email", json=body)
    assert mail.sent[-1][1] == "Ihr Sessio-Prüfcode für den Wiederherstellungsschlüssel"
    assert 'lang="de"' in (mail.html[-1] or "")
    mail.fail = True
    failed = client.post("/keys/check-code-email", json=body)
    assert failed.status_code == 503
    assert failed.json() == {"code": "email_failed"}
