"""Row-level security and consent enforcement against a real Postgres."""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from sqlalchemy import Connection, Engine, text
from sqlalchemy.exc import DBAPIError

from app.db.errors import db_error_code
from app.db.session import make_engine, user_session

# --- helpers -----------------------------------------------------------------


def as_user(conn: Connection, user_id: uuid.UUID | None) -> None:
    conn.execute(text("SET LOCAL ROLE sessio_app"))
    conn.execute(
        text("SELECT set_config('app.user_id', :uid, true)"),
        {"uid": str(user_id) if user_id else ""},
    )


def as_owner(conn: Connection) -> None:
    conn.execute(text("RESET ROLE"))


@contextmanager
def raises_code(conn: Connection, code: str) -> Iterator[None]:
    savepoint = conn.begin_nested()
    with pytest.raises(DBAPIError) as info:
        yield
    savepoint.rollback()
    assert db_error_code(info.value) == code


@contextmanager
def raises_sqlstate(conn: Connection, sqlstate: str) -> Iterator[None]:
    savepoint = conn.begin_nested()
    with pytest.raises(DBAPIError) as info:
        yield
    savepoint.rollback()
    assert getattr(info.value.orig, "sqlstate", None) == sqlstate


def scalar(conn: Connection, sql: str, **params: object) -> object:
    return conn.execute(text(sql), params).scalar_one()


def make_user(conn: Connection) -> uuid.UUID:
    return uuid.UUID(
        str(
            scalar(
                conn,
                "INSERT INTO users (email, display_name) VALUES (:e, 'T') RETURNING id",
                e=f"{uuid.uuid4()}@example.test",
            )
        )
    )


def make_client(conn: Connection, user_id: uuid.UUID, status: str = "active") -> uuid.UUID:
    return uuid.UUID(
        str(
            scalar(
                conn,
                "INSERT INTO clients (user_id, identity_enc, status) "
                "VALUES (:u, '\\x00', :s) RETURNING id",
                u=user_id,
                s=status,
            )
        )
    )


def latest_text(conn: Connection, kind: str, language: str = "de") -> uuid.UUID:
    return uuid.UUID(
        str(
            scalar(
                conn,
                "SELECT id FROM consent_texts WHERE kind = :k AND language = :l "
                "ORDER BY version DESC LIMIT 1",
                k=kind,
                l=language,
            )
        )
    )


def grant(conn: Connection, client_id: uuid.UUID, kind: str) -> uuid.UUID:
    return uuid.UUID(
        str(
            scalar(
                conn,
                "INSERT INTO consents (client_id, kind, consent_text_id, method) "
                "VALUES (:c, :k, :t, 'tablet_signature') RETURNING id",
                c=client_id,
                k=kind,
                t=latest_text(conn, kind),
            )
        )
    )


def grant_both(conn: Connection, client_id: uuid.UUID) -> None:
    grant(conn, client_id, "recording")
    grant(conn, client_id, "ai_processing")


def make_session(conn: Connection, user_id: uuid.UUID, client_id: uuid.UUID) -> uuid.UUID:
    session_id = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO sessions (id, client_id, user_id, started_at, retention_deadline) "
            "VALUES (:id, :c, :u, now(), now() + interval '30 days')"
        ),
        {"id": session_id, "c": client_id, "u": user_id},
    )
    return session_id


def add_chunk(conn: Connection, session_id: uuid.UUID, seq: int, sha: str = "a") -> None:
    conn.execute(
        text(
            "INSERT INTO audio_chunks (session_id, seq, object_key, sha256, bytes) "
            "VALUES (:s, :q, :k, :h, 10)"
        ),
        {"s": session_id, "q": seq, "k": f"sessions/{session_id}/{seq}", "h": sha},
    )


def count(conn: Connection, table: str) -> int:
    return int(str(scalar(conn, f"SELECT count(*) FROM {table}")))  # noqa: S608


# --- row-level security ------------------------------------------------------


def test_user_sees_only_own_rows_without_where_clause(conn: Connection) -> None:
    a, b = make_user(conn), make_user(conn)
    client_a, client_b = make_client(conn, a), make_client(conn, b)
    grant_both(conn, client_a)
    grant_both(conn, client_b)
    session_b = make_session(conn, b, client_b)
    add_chunk(conn, session_b, 0)

    as_user(conn, a)
    assert scalar(conn, "SELECT count(*) FROM users") == 1
    assert [r[0] for r in conn.execute(text("SELECT id FROM clients"))] == [client_a]
    assert count(conn, "consents") == 2
    assert count(conn, "sessions") == 0
    assert count(conn, "audio_chunks") == 0


def test_no_user_bound_sees_nothing(conn: Connection) -> None:
    a = make_user(conn)
    make_client(conn, a)
    as_user(conn, None)
    for table in ("users", "clients", "consents", "sessions", "audio_chunks", "audit_log"):
        assert count(conn, table) == 0, table


def test_cannot_write_rows_for_another_user(conn: Connection) -> None:
    a, b = make_user(conn), make_user(conn)
    client_b = make_client(conn, b)
    grant_both(conn, client_b)

    as_user(conn, a)
    with raises_sqlstate(conn, "42501"):  # RLS WITH CHECK violation
        make_client(conn, b)
    with raises_code(conn, "client_not_found"):
        make_session(conn, a, client_b)


def test_app_engine_runs_as_restricted_role(owner_engine: Engine, migrated_url: str) -> None:
    with owner_engine.begin() as owner:
        user_id = make_user(owner)
    engine = make_engine(migrated_url)
    try:
        with engine.connect() as app_conn:
            assert app_conn.execute(text("SELECT current_user")).scalar_one() == "sessio_app"
            assert count(app_conn, "users") == 0
        with user_session(user_id, engine) as db:
            assert db.execute(text("SELECT count(*) FROM users")).scalar_one() == 1
    finally:
        engine.dispose()
        with owner_engine.begin() as owner:
            owner.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})


# --- consent enforcement -----------------------------------------------------


@pytest.mark.parametrize("kinds", [(), ("recording",), ("ai_processing",)])
def test_session_requires_both_consents(conn: Connection, kinds: tuple[str, ...]) -> None:
    user = make_user(conn)
    client = make_client(conn, user)
    for kind in kinds:
        grant(conn, client, kind)
    as_user(conn, user)
    with raises_code(conn, "consent_missing"):
        make_session(conn, user, client)


def test_session_allowed_with_both_consents(conn: Connection) -> None:
    user = make_user(conn)
    client = make_client(conn, user)
    as_user(conn, user)
    grant_both(conn, client)
    make_session(conn, user, client)
    assert count(conn, "sessions") == 1


def test_withdrawn_consent_blocks_session(conn: Connection) -> None:
    user = make_user(conn)
    client = make_client(conn, user)
    as_user(conn, user)
    grant(conn, client, "recording")
    consent = grant(conn, client, "ai_processing")
    conn.execute(text("UPDATE consents SET withdrawn_at = now() WHERE id = :id"), {"id": consent})
    with raises_code(conn, "consent_missing"):
        make_session(conn, user, client)


def test_new_consent_text_version_requires_reconsent(conn: Connection) -> None:
    user = make_user(conn)
    client = make_client(conn, user)
    grant_both(conn, client)
    conn.execute(
        text(
            "INSERT INTO consent_texts (kind, version, language, body) "
            "VALUES ('recording', 1, 'de', 'v1')"
        )
    )
    as_user(conn, user)
    with raises_code(conn, "consent_missing"):
        make_session(conn, user, client)
    grant(conn, client, "recording")  # re-consent on version 1
    make_session(conn, user, client)


def test_inactive_client_cannot_be_recorded(conn: Connection) -> None:
    user = make_user(conn)
    client = make_client(conn, user, status="restricted")
    grant_both(conn, client)
    as_user(conn, user)
    with raises_code(conn, "client_not_active"):
        make_session(conn, user, client)


def test_consent_text_kind_must_match(conn: Connection) -> None:
    user = make_user(conn)
    client = make_client(conn, user)
    as_user(conn, user)
    with raises_code(conn, "consent_text_kind_mismatch"):
        conn.execute(
            text(
                "INSERT INTO consents (client_id, kind, consent_text_id, method) "
                "VALUES (:c, 'recording', :t, 'tablet_signature')"
            ),
            {"c": client, "t": latest_text(conn, "ai_processing")},
        )


def test_withdrawal_is_final_and_only_change_allowed(conn: Connection) -> None:
    user = make_user(conn)
    client = make_client(conn, user)
    as_user(conn, user)
    consent = grant(conn, client, "recording")
    with raises_sqlstate(conn, "42501"):  # no column privilege
        conn.execute(
            text("UPDATE consents SET kind = 'ai_processing' WHERE id = :id"), {"id": consent}
        )
    conn.execute(text("UPDATE consents SET withdrawn_at = now() WHERE id = :id"), {"id": consent})
    with raises_code(conn, "consent_immutable"):
        conn.execute(
            text("UPDATE consents SET withdrawn_at = NULL WHERE id = :id"), {"id": consent}
        )
    with raises_sqlstate(conn, "42501"):
        conn.execute(text("DELETE FROM consents WHERE id = :id"), {"id": consent})


# --- audio chunks ------------------------------------------------------------


def test_duplicate_chunk_is_idempotent_and_conflict_rejected(conn: Connection) -> None:
    user = make_user(conn)
    client = make_client(conn, user)
    as_user(conn, user)
    grant_both(conn, client)
    session = make_session(conn, user, client)
    add_chunk(conn, session, 0, sha="aaa")
    add_chunk(conn, session, 0, sha="aaa")  # retry after network drop
    assert count(conn, "audio_chunks") == 1
    with raises_code(conn, "chunk_conflict"):
        add_chunk(conn, session, 0, sha="bbb")


def test_withdrawal_mid_session_blocks_chunks_and_marks_audio_for_deletion(
    conn: Connection,
) -> None:
    user = make_user(conn)
    client = make_client(conn, user)
    as_user(conn, user)
    grant(conn, client, "ai_processing")
    recording = grant(conn, client, "recording")
    session = make_session(conn, user, client)
    add_chunk(conn, session, 0)

    conn.execute(text("UPDATE consents SET withdrawn_at = now() WHERE id = :id"), {"id": recording})

    state = scalar(conn, "SELECT audio_state FROM sessions WHERE id = :id", id=session)
    assert state == "shred_pending"
    with raises_code(conn, "audio_not_accepted"):
        add_chunk(conn, session, 1)


def test_chunks_require_consent_even_if_session_exists(conn: Connection) -> None:
    user = make_user(conn)
    client = make_client(conn, user)
    as_user(conn, user)
    grant(conn, client, "ai_processing")
    recording = grant(conn, client, "recording")
    session = make_session(conn, user, client)
    as_owner(conn)
    # Simulate a session whose audio is still accepted although consent is gone.
    conn.execute(text("ALTER TABLE consents DISABLE TRIGGER consents_withdraw"))
    conn.execute(text("UPDATE consents SET withdrawn_at = now() WHERE id = :id"), {"id": recording})
    conn.execute(text("ALTER TABLE consents ENABLE TRIGGER consents_withdraw"))
    as_user(conn, user)
    with raises_code(conn, "consent_missing"):
        add_chunk(conn, session, 0)


# --- immutability and retention -----------------------------------------------


def test_consent_texts_and_audit_log_are_immutable_even_for_owner(conn: Connection) -> None:
    user = make_user(conn)
    conn.execute(
        text("INSERT INTO audit_log (actor_user_id, action, entity) VALUES (:u, 'x', 'y')"),
        {"u": user},
    )
    with raises_code(conn, "consent_texts_immutable"):
        conn.execute(text("UPDATE consent_texts SET body = 'changed'"))
    with raises_code(conn, "consent_texts_immutable"):
        conn.execute(text("DELETE FROM consent_texts"))
    with raises_code(conn, "audit_log_immutable"):
        conn.execute(text("UPDATE audit_log SET action = 'z'"))
    with raises_code(conn, "audit_log_immutable"):
        conn.execute(text("DELETE FROM audit_log"))


def test_retention_deadline_cannot_exceed_30_days(conn: Connection) -> None:
    user = make_user(conn)
    client = make_client(conn, user)
    grant_both(conn, client)
    with raises_sqlstate(conn, "23514"):
        conn.execute(
            text(
                "INSERT INTO sessions (id, client_id, user_id, started_at, retention_deadline) "
                "VALUES (:id, :c, :u, now(), now() + interval '31 days')"
            ),
            {"id": uuid.uuid4(), "c": client, "u": user},
        )


def test_placeholder_consent_texts_seeded_in_both_languages(conn: Connection) -> None:
    rows = conn.execute(text("SELECT kind, language, body FROM consent_texts WHERE version = 0"))
    seeded = {(kind, lang): body for kind, lang, body in rows}
    for kind in ("recording", "ai_processing", "product_improvement"):
        assert seeded[(kind, "de")].startswith("PROTOTYP")
        assert seeded[(kind, "en")].startswith("PROTOTYPE")
