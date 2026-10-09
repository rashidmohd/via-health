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
