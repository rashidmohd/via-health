"""Core schema, row-level security and consent enforcement.

See docs/plans/0001-data-model-and-consent.md.

Revision ID: 835036395acb
Revises:
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "835036395acb"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# App connections run as this role (SET ROLE), so RLS applies even for the DB owner.
ROLES_AND_GRANTS = """
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sessio_app') THEN
        CREATE ROLE sessio_app NOLOGIN;
    END IF;
END $$;
GRANT sessio_app TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO sessio_app;
GRANT SELECT ON consent_texts TO sessio_app;
GRANT SELECT, INSERT, UPDATE ON users, clients, sessions TO sessio_app;
GRANT SELECT, INSERT ON consents TO sessio_app;
GRANT UPDATE (withdrawn_at) ON consents TO sessio_app;
GRANT SELECT, INSERT, DELETE ON audio_chunks TO sessio_app;
GRANT SELECT, INSERT, DELETE ON wrapped_keys TO sessio_app;
GRANT SELECT, INSERT ON audit_log TO sessio_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO sessio_app;
"""

# Missing or empty app.user_id -> NULL -> no rows match (fails closed).
CURRENT_USER_FN = """
CREATE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;
"""

RLS = """
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON users
    USING (id = app_current_user_id())
    WITH CHECK (id = app_current_user_id());

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON clients
    USING (user_id = app_current_user_id())
    WITH CHECK (user_id = app_current_user_id());

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON consents
    USING (EXISTS (SELECT 1 FROM clients c
                   WHERE c.id = consents.client_id AND c.user_id = app_current_user_id()));

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON sessions
    USING (user_id = app_current_user_id())
    WITH CHECK (user_id = app_current_user_id()
                AND EXISTS (SELECT 1 FROM clients c
                            WHERE c.id = sessions.client_id
                              AND c.user_id = app_current_user_id()));

ALTER TABLE audio_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON audio_chunks
    USING (EXISTS (SELECT 1 FROM sessions s
                   WHERE s.id = audio_chunks.session_id AND s.user_id = app_current_user_id()));

ALTER TABLE wrapped_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE wrapped_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON wrapped_keys
    USING (EXISTS (SELECT 1 FROM sessions s
                   WHERE s.id = wrapped_keys.session_id AND s.user_id = app_current_user_id()));

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON audit_log
    USING (actor_user_id = app_current_user_id())
    WITH CHECK (actor_user_id = app_current_user_id());
"""

# Error messages are stable codes; the API maps them, the UI translates them (de/en).
CONSENT_ENFORCEMENT = """
CREATE FUNCTION client_has_recording_consent(p_client_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT count(DISTINCT c.kind) = 2
    FROM consents c
    JOIN consent_texts t ON t.id = c.consent_text_id
    WHERE c.client_id = p_client_id
      AND c.kind IN ('recording', 'ai_processing')
      AND c.withdrawn_at IS NULL
      AND t.version = (SELECT max(t2.version) FROM consent_texts t2 WHERE t2.kind = c.kind)
$$;

CREATE FUNCTION sessions_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status FROM clients
    WHERE id = NEW.client_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'client_not_found';
    END IF;
    IF v_status <> 'active' THEN
        RAISE EXCEPTION 'client_not_active';
    END IF;
    IF NOT client_has_recording_consent(NEW.client_id) THEN
        RAISE EXCEPTION 'consent_missing';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER sessions_consent_check BEFORE INSERT ON sessions
    FOR EACH ROW EXECUTE FUNCTION sessions_before_insert();

-- Re-upload of an identical chunk is a no-op; a different chunk under the same seq is an error.
CREATE FUNCTION audio_chunks_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_existing_sha text;
    v_client_id uuid;
    v_audio_state text;
BEGIN
    SELECT sha256 INTO v_existing_sha FROM audio_chunks
    WHERE session_id = NEW.session_id AND seq = NEW.seq;
    IF FOUND THEN
        IF v_existing_sha = NEW.sha256 THEN
            RETURN NULL;
        END IF;
        RAISE EXCEPTION 'chunk_conflict';
    END IF;

    SELECT client_id, audio_state INTO v_client_id, v_audio_state FROM sessions
    WHERE id = NEW.session_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found';
    END IF;
    IF v_audio_state <> 'present' THEN
        RAISE EXCEPTION 'audio_not_accepted';
    END IF;
    IF NOT client_has_recording_consent(v_client_id) THEN
        RAISE EXCEPTION 'consent_missing';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER audio_chunks_consent_check BEFORE INSERT ON audio_chunks
    FOR EACH ROW EXECUTE FUNCTION audio_chunks_before_insert();

CREATE FUNCTION consents_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM consent_texts
                   WHERE id = NEW.consent_text_id AND kind = NEW.kind) THEN
        RAISE EXCEPTION 'consent_text_kind_mismatch';
    END IF;
    IF NEW.withdrawn_at IS NOT NULL THEN
        RAISE EXCEPTION 'consent_invalid';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER consents_check_insert BEFORE INSERT ON consents
    FOR EACH ROW EXECUTE FUNCTION consents_before_insert();

-- Consents only change by being withdrawn, once.
CREATE FUNCTION consents_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL
       OR (to_jsonb(NEW) - 'withdrawn_at') <> (to_jsonb(OLD) - 'withdrawn_at') THEN
        RAISE EXCEPTION 'consent_immutable';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER consents_check_update BEFORE UPDATE ON consents
    FOR EACH ROW EXECUTE FUNCTION consents_before_update();

-- Withdrawal: unprocessed audio of this client is queued for deletion (rule 10).
CREATE FUNCTION consents_after_withdraw() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind IN ('recording', 'ai_processing') THEN
        UPDATE sessions SET audio_state = 'shred_pending'
        WHERE client_id = NEW.client_id
          AND audio_state = 'present'
          AND status IN ('recording', 'uploaded', 'processing', 'failed');
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER consents_withdraw AFTER UPDATE OF withdrawn_at ON consents
    FOR EACH ROW EXECUTE FUNCTION consents_after_withdraw();
"""

IMMUTABLE_TABLES = """
CREATE FUNCTION reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '%_immutable', TG_TABLE_NAME;
END $$;

CREATE TRIGGER consent_texts_immutable BEFORE UPDATE OR DELETE ON consent_texts
    FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER consent_texts_no_truncate BEFORE TRUNCATE ON consent_texts
    FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION reject_change();
"""

# ADR 0002: placeholder texts, version 0, never for real clients.
PLACEHOLDER_CONSENT_TEXTS = [
    (
        "recording",
        "de",
        "PROTOTYP – nicht rechtlich geprüft. Ich willige ein, dass diese Sitzung als Audio "
        "aufgezeichnet wird. Die Aufnahme ist verschlüsselt und wird gelöscht, sobald der "
        "Bericht unterschrieben ist, spätestens nach 30 Tagen. Ich kann diese Einwilligung "
        "jederzeit widerrufen.",
    ),
    (
        "recording",
        "en",
        "PROTOTYPE – not legally reviewed. I agree that this session is recorded as audio. "
        "The recording is encrypted and deleted once the report is signed, at the latest "
        "after 30 days. I can withdraw this consent at any time.",
    ),
    (
        "ai_processing",
        "de",
        "PROTOTYP – nicht rechtlich geprüft. Ich willige ein, dass die Aufnahme in der EU "
        "automatisch transkribiert wird und daraus ein Berichtsentwurf erstellt wird. Meine "
        "Therapeutin oder mein Therapeut prüft jeden Entwurf. Ich kann diese Einwilligung "
        "jederzeit widerrufen.",
    ),
    (
        "ai_processing",
        "en",
        "PROTOTYPE – not legally reviewed. I agree that the recording is automatically "
        "transcribed in the EU and used to draft a report. My therapist reviews every draft. "
        "I can withdraw this consent at any time.",
    ),
    (
        "product_improvement",
        "de",
        "PROTOTYP – nicht rechtlich geprüft. Optional: Ich willige ein, dass anonymisierte "
        "Nutzungsdaten zur Verbesserung des Produkts verwendet werden. Ohne diese Einwilligung "
        "ändert sich nichts an meiner Behandlung.",
    ),
    (
        "product_improvement",
        "en",
        "PROTOTYPE – not legally reviewed. Optional: I agree that anonymised usage data is used "
        "to improve the product. Declining does not change my treatment in any way.",
    ),
]


# The role is cluster-wide and may be used by other databases; drop it only if unused.
DROP_FUNCTIONS_AND_ROLE = """
DROP FUNCTION reject_change();
DROP FUNCTION consents_after_withdraw();
DROP FUNCTION consents_before_update();
DROP FUNCTION consents_before_insert();
DROP FUNCTION audio_chunks_before_insert();
DROP FUNCTION sessions_before_insert();
DROP FUNCTION client_has_recording_consent(uuid);
DROP FUNCTION app_current_user_id();
DROP OWNED BY sessio_app;
DO $$ BEGIN
    DROP ROLE IF EXISTS sessio_app;
EXCEPTION WHEN dependent_objects_still_exist THEN NULL;
END $$;
"""


def _seed_consent_texts() -> None:
    table = sa.table(
        "consent_texts",
        sa.column("kind", sa.Text),
        sa.column("version", sa.Integer),
        sa.column("language", sa.Text),
        sa.column("body", sa.Text),
    )
    op.bulk_insert(
        table,
        [
            {"kind": kind, "version": 0, "language": lang, "body": body}
            for kind, lang, body in PLACEHOLDER_CONSENT_TEXTS
        ],
    )


def upgrade() -> None:
    op.create_table(
        "consent_texts",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('recording', 'ai_processing', 'product_improvement')",
            name=op.f("ck_consent_texts_kind"),
        ),
        sa.CheckConstraint("language IN ('de', 'en')", name=op.f("ck_consent_texts_language")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_consent_texts")),
        sa.UniqueConstraint(
            "kind", "version", "language", name="uq_consent_texts_kind_version_language"
        ),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("ui_language", sa.Text(), server_default="de", nullable=False),
        sa.Column("pgp_public_key", sa.Text(), nullable=True),
        sa.Column("pgp_private_key_enc", sa.LargeBinary(), nullable=True),
        sa.Column("recovery_public_key", sa.Text(), nullable=True),
        sa.Column("key_fingerprints", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("ui_language IN ('de', 'en')", name=op.f("ck_users_ui_language")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("actor_user_id", sa.UUID(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("entity", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(
            ["actor_user_id"], ["users.id"], name=op.f("fk_audit_log_actor_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log")),
    )
    op.create_index(
        op.f("ix_audit_log_actor_user_id"), "audit_log", ["actor_user_id"], unique=False
    )
    op.create_table(
        "clients",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("identity_enc", sa.LargeBinary(), nullable=False),
        sa.Column("preferred_language", sa.Text(), server_default="de", nullable=False),
        sa.Column("hotwords_enc", sa.LargeBinary(), nullable=True),
        sa.Column("status", sa.Text(), server_default="active", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "preferred_language IN ('de', 'en')", name=op.f("ck_clients_preferred_language")
        ),
        sa.CheckConstraint(
            "status IN ('active', 'restricted', 'archived')", name=op.f("ck_clients_status")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_clients_user_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_clients")),
    )
    op.create_index(op.f("ix_clients_user_id"), "clients", ["user_id"], unique=False)
    op.create_table(
        "consents",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("client_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("consent_text_id", sa.UUID(), nullable=False),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("signature_enc", sa.LargeBinary(), nullable=True),
        sa.Column("signed_by", sa.Text(), server_default="client", nullable=False),
        sa.CheckConstraint(
            "kind IN ('recording', 'ai_processing', 'product_improvement')",
            name=op.f("ck_consents_kind"),
        ),
        sa.CheckConstraint(
            "method IN ('tablet_signature', 'remote_link')", name=op.f("ck_consents_method")
        ),
        sa.CheckConstraint(
            "signed_by IN ('client', 'guardian')", name=op.f("ck_consents_signed_by")
        ),
        sa.ForeignKeyConstraint(
            ["client_id"], ["clients.id"], name=op.f("fk_consents_client_id_clients")
        ),
        sa.ForeignKeyConstraint(
            ["consent_text_id"],
            ["consent_texts.id"],
            name=op.f("fk_consents_consent_text_id_consent_texts"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_consents")),
    )
    op.create_index(op.f("ix_consents_client_id"), "consents", ["client_id"], unique=False)
    op.create_table(
        "sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("client_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), server_default="recording", nullable=False),
        sa.Column("audio_state", sa.Text(), server_default="present", nullable=False),
        sa.Column("total_chunks", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("template_id", sa.UUID(), nullable=True),
        sa.Column("retention_deadline", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "audio_state IN ('present', 'shred_pending', 'shredded')",
            name=op.f("ck_sessions_audio_state"),
        ),
        sa.CheckConstraint(
            "status IN ('recording', 'uploaded', 'processing', 'draft_ready', 'signed', 'failed')",
            name=op.f("ck_sessions_status"),
        ),
        sa.CheckConstraint(
            "retention_deadline <= started_at + interval '30 days'",
            name=op.f("ck_sessions_retention_max"),
        ),
        sa.ForeignKeyConstraint(
            ["client_id"], ["clients.id"], name=op.f("fk_sessions_client_id_clients")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_sessions_user_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
    )
    op.create_index(op.f("ix_sessions_client_id"), "sessions", ["client_id"], unique=False)
    op.create_index(op.f("ix_sessions_user_id"), "sessions", ["user_id"], unique=False)
    op.create_table(
        "audio_chunks",
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("seq >= 0", name=op.f("ck_audio_chunks_seq_non_negative")),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], name=op.f("fk_audio_chunks_session_id_sessions")
        ),
        sa.PrimaryKeyConstraint("session_id", "seq", name="pk_audio_chunks"),
    )
    op.create_table(
        "wrapped_keys",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("kms_key_version", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('therapist', 'processing')", name=op.f("ck_wrapped_keys_kind")
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], name=op.f("fk_wrapped_keys_session_id_sessions")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_wrapped_keys")),
        sa.UniqueConstraint("session_id", "kind", name="uq_wrapped_keys_session_id_kind"),
    )
    op.create_index(
        op.f("ix_wrapped_keys_session_id"), "wrapped_keys", ["session_id"], unique=False
    )

    op.execute(CURRENT_USER_FN)
    op.execute(ROLES_AND_GRANTS)
    op.execute(RLS)
    op.execute(CONSENT_ENFORCEMENT)
    op.execute(IMMUTABLE_TABLES)
    _seed_consent_texts()


def downgrade() -> None:
    op.drop_index(op.f("ix_wrapped_keys_session_id"), table_name="wrapped_keys")
    op.drop_table("wrapped_keys")
    op.drop_table("audio_chunks")
    op.drop_index(op.f("ix_sessions_user_id"), table_name="sessions")
    op.drop_index(op.f("ix_sessions_client_id"), table_name="sessions")
    op.drop_table("sessions")
    op.drop_index(op.f("ix_consents_client_id"), table_name="consents")
    op.drop_table("consents")
    op.drop_index(op.f("ix_clients_user_id"), table_name="clients")
    op.drop_table("clients")
    op.drop_index(op.f("ix_audit_log_actor_user_id"), table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_table("users")
    op.drop_table("consent_texts")
    op.execute(DROP_FUNCTIONS_AND_ROLE)
