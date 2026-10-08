"""Email-code signup/login against a fresh real Postgres per test."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.api_helpers import FakeEmailSender, login, start


def wrong_code(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


# --- signup and login ----------------------------------------------------------


def test_signup_creates_account_and_logs_in(client: TestClient, mail: FakeEmailSender) -> None:
    me = login(client, mail, "Anna@Example.com", display_name="Anna Weber", language="de")
    assert me["email"] == "anna@example.com"
    assert me["display_name"] == "Anna Weber"
    assert me["ui_language"] == "de"
    assert client.get("/auth/me").json()["id"] == me["id"]


def test_login_existing_account_is_case_insensitive(
    client: TestClient, mail: FakeEmailSender
) -> None:
    first = login(client, mail, "anna@example.com", display_name="Anna")
    client.cookies.clear()
    again = login(client, mail, "  ANNA@example.COM ", display_name="Ignored")
    assert again["id"] == first["id"]
    assert again["display_name"] == "Anna"


def test_login_without_name_creates_account_with_empty_name(
    client: TestClient, mail: FakeEmailSender
) -> None:
    me = login(client, mail, "new@example.com")
    assert me["display_name"] == ""
    updated = client.patch("/auth/me", json={"display_name": "Ben"})
    assert updated.json()["display_name"] == "Ben"


def test_start_gives_same_answer_for_new_and_existing_email(
    client: TestClient, mail: FakeEmailSender
) -> None:
    login(client, mail, "known@example.com")
    known = client.post("/auth/email/start", json={"email": "known@example.com"})
    unknown = client.post("/auth/email/start", json={"email": "unknown@example.com"})
    assert (known.status_code, known.json()) == (unknown.status_code, unknown.json())


def test_email_is_in_requested_language(client: TestClient, mail: FakeEmailSender) -> None:
    start(client, "a@example.com", language="de")
    assert "Anmeldecode" in mail.sent[-1][1]
    start(client, "a@example.com", language="en")
    assert "sign-in code" in mail.sent[-1][1]


# --- code failures -------------------------------------------------------------


def test_wrong_code_rejected(client: TestClient, mail: FakeEmailSender) -> None:
    start(client, "a@example.com")
    response = client.post(
        "/auth/email/verify", json={"email": "a@example.com", "code": wrong_code(mail.last_code())}
    )
    assert (response.status_code, response.json()) == (400, {"code": "code_invalid"})
    assert client.get("/auth/me").status_code == 401


def test_code_locked_after_five_wrong_attempts(client: TestClient, mail: FakeEmailSender) -> None:
    start(client, "a@example.com")
    code = mail.last_code()
    for _ in range(5):
        client.post("/auth/email/verify", json={"email": "a@example.com", "code": wrong_code(code)})
    response = client.post("/auth/email/verify", json={"email": "a@example.com", "code": code})
    assert response.json() == {"code": "code_invalid"}


def test_code_is_single_use(client: TestClient, mail: FakeEmailSender) -> None:
    start(client, "a@example.com")
    code = mail.last_code()
    assert client.post(
        "/auth/email/verify", json={"email": "a@example.com", "code": code}
    ).is_success
    again = client.post("/auth/email/verify", json={"email": "a@example.com", "code": code})
    assert again.json() == {"code": "code_invalid"}


def test_expired_code_rejected(client: TestClient, mail: FakeEmailSender, owner: Engine) -> None:
    start(client, "a@example.com")
    with owner.begin() as c:
        c.execute(text("UPDATE login_codes SET expires_at = now() - interval '1 second'"))
    response = client.post(
        "/auth/email/verify", json={"email": "a@example.com", "code": mail.last_code()}
    )
    assert response.json() == {"code": "code_invalid"}


def test_code_for_other_email_rejected(client: TestClient, mail: FakeEmailSender) -> None:
    start(client, "a@example.com")
    response = client.post(
        "/auth/email/verify", json={"email": "b@example.com", "code": mail.last_code()}
    )
    assert response.json() == {"code": "code_invalid"}


def test_rate_limit_per_email(client: TestClient) -> None:
    statuses = [start(client, "a@example.com") for _ in range(6)]
    assert statuses == [202] * 5 + [429]


def test_email_failure_reported_and_code_not_stored(
    client: TestClient, mail: FakeEmailSender, owner: Engine
) -> None:
    mail.fail = True
    response = client.post("/auth/email/start", json={"email": "a@example.com"})
    assert (response.status_code, response.json()) == (502, {"code": "email_failed"})
    with owner.connect() as c:
        assert c.execute(text("SELECT count(*) FROM login_codes")).scalar_one() == 0


def test_invalid_input_does_not_echo_data(client: TestClient) -> None:
    response = client.post("/auth/email/start", json={"email": "not-an-email"})
    assert (response.status_code, response.json()) == (422, {"code": "invalid_input"})


def test_codes_and_emails_stored_only_as_hashes(
    client: TestClient, mail: FakeEmailSender, owner: Engine
) -> None:
    start(client, "secret@example.com")
    with owner.connect() as c:
        row = c.execute(text("SELECT email_hash, code_hash FROM login_codes")).one()
    assert "secret" not in row.email_hash
    assert mail.last_code() not in row.code_hash


# --- sessions ------------------------------------------------------------------


def test_cookie_is_http_only(client: TestClient, mail: FakeEmailSender) -> None:
    start(client, "a@example.com")
    response = client.post(
        "/auth/email/verify", json={"email": "a@example.com", "code": mail.last_code()}
    )
    cookie = response.headers["set-cookie"].lower()
    assert "sessio_auth=" in cookie
    assert "httponly" in cookie
    assert "samesite=lax" in cookie


def test_logout_revokes_session(client: TestClient, mail: FakeEmailSender) -> None:
    login(client, mail, "a@example.com")
    token = client.cookies.get("sessio_auth")
    assert client.post("/auth/logout").status_code == 204
    client.cookies.set("sessio_auth", token or "")
    assert client.get("/auth/me").status_code == 401


@pytest.mark.parametrize(
    "change",
    [
        "UPDATE auth_sessions SET last_seen_at = now() - interval '3 hours'",
        "UPDATE auth_sessions SET created_at = now() - interval '13 hours', "
        "expires_at = now() - interval '1 hour'",
        "UPDATE auth_sessions SET revoked_at = now()",
    ],
    ids=["idle", "expired", "revoked"],
)
def test_invalid_session_rejected(
    client: TestClient, mail: FakeEmailSender, owner: Engine, change: str
) -> None:
    login(client, mail, "a@example.com")
    with owner.begin() as c:
        c.execute(text(change))
    assert client.get("/auth/me").json() == {"code": "not_authenticated"}


def test_unknown_cookie_rejected(client: TestClient) -> None:
    client.cookies.set("sessio_auth", "made-up")
    assert client.get("/auth/me").status_code == 401


def test_users_only_see_their_own_auth_sessions(
    client: TestClient, mail: FakeEmailSender, owner: Engine
) -> None:
    a = login(client, mail, "a@example.com")
    client.cookies.clear()
    login(client, mail, "b@example.com")
    with owner.connect() as c, c.begin():
        c.execute(text("SET LOCAL ROLE sessio_app"))
        c.execute(text("SELECT set_config('app.user_id', :u, true)"), {"u": a["id"]})
        rows = c.execute(text("SELECT user_id FROM auth_sessions")).scalars().all()
    assert [str(r) for r in rows] == [a["id"]]


# --- origin check --------------------------------------------------------------


def test_post_from_other_origin_rejected(client: TestClient) -> None:
    response = client.post(
        "/auth/email/start",
        json={"email": "a@example.com"},
        headers={"Origin": "https://evil.example"},
    )
    assert (response.status_code, response.json()) == (403, {"code": "origin_not_allowed"})


def test_post_without_origin_rejected(client: TestClient) -> None:
    del client.headers["Origin"]
    response = client.post("/auth/email/start", json={"email": "a@example.com"})
    assert response.status_code == 403
