"""Clients and consent capture against a fresh real Postgres per test."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.api_helpers import PNG, FakeEmailSender, login


@pytest.fixture
def therapist(client: TestClient, mail: FakeEmailSender) -> dict[str, str]:
    return login(client, mail, "therapist@example.com", display_name="T")


def add_client(client: TestClient, name: str = "Anna Weber", **extra: Any) -> dict[str, Any]:
    response = client.post("/clients", json={"name": name, **extra})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def grant(client: TestClient, client_id: str, kinds: list[str], **extra: Any) -> Any:
    return client.post(
        f"/clients/{client_id}/consents",
        json={"kinds": kinds, "language": "de", "signature": PNG, **extra},
    )


# --- clients -------------------------------------------------------------------


def test_create_and_list_client(client: TestClient, therapist: dict[str, str]) -> None:
    created = add_client(client, "Anna Weber", date_of_birth="1990-04-01", preferred_language="en")
    assert created["identity"]["date_of_birth"] == "1990-04-01"
    assert created["consent"] == {
        "recording": "missing",
        "ai_processing": "missing",
        "product_improvement": "missing",
    }
    assert created["ready_to_record"] is False

    listed = client.get("/clients").json()
    assert [(c["name"], c["preferred_language"]) for c in listed] == [("Anna Weber", "en")]


def test_identity_is_encrypted_in_database(
    client: TestClient, therapist: dict[str, str], owner: Engine
) -> None:
    add_client(client, "Anna Weber", email="anna@example.com", phone="+49 30 1234")
    with owner.connect() as c:
        blob = bytes(c.execute(text("SELECT identity_enc FROM clients")).scalar_one())
    for secret in (b"Anna", b"Weber", b"anna@example.com", b"1234"):
        assert secret not in blob


def test_list_sorted_by_name_archived_last(client: TestClient, therapist: dict[str, str]) -> None:
    zoe = add_client(client, "Zoe")
    add_client(client, "anna")
    add_client(client, "Ben")
    client.patch(f"/clients/{zoe['id']}", json={"status": "archived"})
    client.patch(f"/clients/{add_client(client, 'Aaron')['id']}", json={"status": "archived"})
    assert [c["name"] for c in client.get("/clients").json()] == ["anna", "Ben", "Aaron", "Zoe"]


def test_edit_client(client: TestClient, therapist: dict[str, str]) -> None:
    created = add_client(client, "Anna")
    updated = client.patch(
        f"/clients/{created['id']}",
        json={"identity": {"name": "Anna Schmidt"}, "preferred_language": "en"},
    ).json()
    assert (updated["name"], updated["preferred_language"]) == ("Anna Schmidt", "en")


def test_other_therapists_clients_are_invisible(
    client: TestClient, mail: FakeEmailSender, therapist: dict[str, str]
) -> None:
    created = add_client(client, "Anna")
    client.cookies.clear()
    login(client, mail, "other@example.com", display_name="O")
    assert client.get("/clients").json() == []
    assert client.get(f"/clients/{created['id']}").json() == {"code": "client_not_found"}
    assert grant(client, created["id"], ["recording"]).status_code == 404
    assert client.patch(f"/clients/{created['id']}", json={"status": "archived"}).status_code == 404


def test_clients_require_login(client: TestClient) -> None:
    assert client.get("/clients").status_code == 401
    assert client.post("/clients", json={"name": "A"}).status_code == 401


@pytest.mark.parametrize("name", ["", "   "])
def test_name_required(client: TestClient, therapist: dict[str, str], name: str) -> None:
    response = client.post("/clients", json={"name": name})
    assert response.json() == {"code": "invalid_input"}


# --- consent ---------------------------------------------------------------------


def test_consent_texts_in_requested_language(client: TestClient, therapist: dict[str, str]) -> None:
    texts = client.get("/consent-texts", params={"language": "en"}).json()
    assert [t["kind"] for t in texts] == ["recording", "ai_processing", "product_improvement"]
    assert all(t["body"].startswith("PROTOTYPE") for t in texts)


def test_grant_both_makes_client_ready(client: TestClient, therapist: dict[str, str]) -> None:
    created = add_client(client)
    response = grant(client, created["id"], ["recording", "ai_processing"])
    assert response.status_code == 201
    body = response.json()
    assert body["ready_to_record"] is True
    assert body["consent"]["product_improvement"] == "missing"
    assert {c["kind"] for c in body["consents"]} == {"recording", "ai_processing"}
    assert all(c["language"] == "de" and c["signed_by"] == "client" for c in body["consents"])


def test_one_consent_alone_is_not_enough(client: TestClient, therapist: dict[str, str]) -> None:
    created = add_client(client)
    body = grant(client, created["id"], ["recording"]).json()
    assert body["ready_to_record"] is False


def test_each_kind_stored_as_its_own_row_with_encrypted_signature(
    client: TestClient, therapist: dict[str, str], owner: Engine
) -> None:
    created = add_client(client)
    grant(client, created["id"], ["recording", "ai_processing", "product_improvement"])
    with owner.connect() as c:
        rows = c.execute(text("SELECT kind, signature_enc FROM consents")).all()
    assert sorted(r.kind for r in rows) == ["ai_processing", "product_improvement", "recording"]
    assert all(b"iVBOR" not in bytes(r.signature_enc) for r in rows)
    # Same signature, different ciphertexts (bound to each row).
    assert len({bytes(r.signature_enc) for r in rows}) == 3


def test_duplicate_active_consent_rejected(client: TestClient, therapist: dict[str, str]) -> None:
    created = add_client(client)
    grant(client, created["id"], ["recording"])
    response = grant(client, created["id"], ["recording", "ai_processing"])
    assert (response.status_code, response.json()) == (409, {"code": "consent_already_given"})


@pytest.mark.parametrize(
    "payload",
    [
        {"kinds": []},
        {"kinds": ["recording", "recording"]},
        {"kinds": ["something_else"]},
        {"signature": ""},
        {"signature": "data:image/png;base64,not base64!"},
        {"signature": "data:image/svg+xml;base64,PHN2Zz4="},
    ],
)
def test_invalid_consent_rejected(
    client: TestClient, therapist: dict[str, str], payload: dict[str, Any]
) -> None:
    created = add_client(client)
    body = {"kinds": ["recording"], "language": "de", "signature": PNG, **payload}
    response = client.post(f"/clients/{created['id']}/consents", json=body)
    assert response.json() == {"code": "invalid_input"}


def test_withdraw_blocks_recording_and_is_final(
    client: TestClient, therapist: dict[str, str]
) -> None:
    created = add_client(client)
    body = grant(client, created["id"], ["recording", "ai_processing"]).json()
    recording = next(c for c in body["consents"] if c["kind"] == "recording")

    after = client.post(f"/consents/{recording['id']}/withdraw").json()
    assert after["consent"]["recording"] == "withdrawn"
    assert after["ready_to_record"] is False
    again = client.post(f"/consents/{recording['id']}/withdraw")
    assert again.json() == {"code": "consent_immutable"}

    # A new consent can be given after withdrawal.
    regranted = grant(client, created["id"], ["recording"]).json()
    assert regranted["ready_to_record"] is True


def test_new_text_version_makes_consent_outdated(
    client: TestClient, therapist: dict[str, str], owner: Engine
) -> None:
    created = add_client(client)
    grant(client, created["id"], ["recording", "ai_processing"])
    with owner.begin() as c:
        for lang in ("de", "en"):
            c.execute(
                text(
                    "INSERT INTO consent_texts (kind, version, language, body) "
                    "VALUES ('recording', 1, :l, 'v1')"
                ),
                {"l": lang},
            )
    body = client.get(f"/clients/{created['id']}").json()
    assert body["consent"]["recording"] == "outdated"
    assert body["ready_to_record"] is False
    assert grant(client, created["id"], ["recording"]).json()["ready_to_record"] is True


def test_archived_client_cannot_give_consent(client: TestClient, therapist: dict[str, str]) -> None:
    created = add_client(client)
    client.patch(f"/clients/{created['id']}", json={"status": "archived"})
    response = grant(client, created["id"], ["recording"])
    assert response.json() == {"code": "client_not_active"}


def test_guardian_signature_recorded(client: TestClient, therapist: dict[str, str]) -> None:
    created = add_client(client)
    body = grant(client, created["id"], ["recording"], signed_by="guardian").json()
    assert body["consents"][0]["signed_by"] == "guardian"


def test_audit_log_has_ids_only(
    client: TestClient, therapist: dict[str, str], owner: Engine
) -> None:
    created = add_client(client, "Anna Weber")
    grant(client, created["id"], ["recording"])
    with owner.connect() as c:
        rows = c.execute(text("SELECT action, entity_id, meta FROM audit_log")).all()
    actions = [r.action for r in rows]
    assert "client_created" in actions and "consent_granted" in actions
    assert all("Anna" not in str(r) for r in rows)


def test_unknown_client_id(client: TestClient, therapist: dict[str, str]) -> None:
    response = client.get(f"/clients/{uuid.uuid4()}")
    assert (response.status_code, response.json()) == (404, {"code": "client_not_found"})
