"""Transcription: transcripts table, session status `transcribed`, worker DB role.

See docs/plans/0005-transcription.md.

Revision ID: 3e8d1b6f5a42
Revises: 7c2f4a9e0b31
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "3e8d1b6f5a42"
down_revision: str | Sequence[str] | None = "7c2f4a9e0b31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_STATUSES = "'recording', 'uploaded', 'processing', 'draft_ready', 'signed', 'failed'"
NEW_STATUSES = (
    "'recording', 'uploaded', 'processing', 'transcribed', 'draft_ready', 'signed', 'failed'"
)

APP_GRANTS_AND_RLS = """
GRANT SELECT, UPDATE ON transcripts TO sessio_app;

ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON transcripts
    USING (EXISTS (SELECT 1 FROM sessions s
                   WHERE s.id = transcripts.session_id AND s.user_id = app_current_user_id()));
"""

# The worker processes any user's session by id, but never sees client identity:
# column-level grants on clients/consents, no access to users, auth or identity columns.
WORKER_ROLE = """
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sessio_worker') THEN
        CREATE ROLE sessio_worker NOLOGIN;
    END IF;
END $$;
GRANT sessio_worker TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO sessio_worker;
GRANT SELECT ON sessions, audio_chunks, wrapped_keys, object_blobs, consent_texts TO sessio_worker;
GRANT UPDATE (status, failure_reason) ON sessions TO sessio_worker;
GRANT SELECT (id, preferred_language, status) ON clients TO sessio_worker;
GRANT SELECT (client_id, kind, consent_text_id, withdrawn_at) ON consents TO sessio_worker;
GRANT SELECT, INSERT, UPDATE ON transcripts TO sessio_worker;
GRANT INSERT ON audit_log TO sessio_worker;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO sessio_worker;

CREATE POLICY worker_all ON sessions FOR ALL TO sessio_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_read ON audio_chunks FOR SELECT TO sessio_worker USING (true);
CREATE POLICY worker_read ON wrapped_keys FOR SELECT TO sessio_worker USING (true);
CREATE POLICY worker_read ON object_blobs FOR SELECT TO sessio_worker USING (true);
CREATE POLICY worker_read ON clients FOR SELECT TO sessio_worker USING (true);
CREATE POLICY worker_read ON consents FOR SELECT TO sessio_worker USING (true);
CREATE POLICY worker_all ON transcripts FOR ALL TO sessio_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_insert ON audit_log FOR INSERT TO sessio_worker
    WITH CHECK (actor_user_id IS NULL);
"""

DROP_WORKER = """
DROP POLICY worker_all ON sessions;
DROP POLICY worker_read ON audio_chunks;
DROP POLICY worker_read ON wrapped_keys;
DROP POLICY worker_read ON object_blobs;
DROP POLICY worker_read ON clients;
DROP POLICY worker_read ON consents;
DROP POLICY worker_insert ON audit_log;
DROP OWNED BY sessio_worker;
DO $$ BEGIN
    DROP ROLE IF EXISTS sessio_worker;
EXCEPTION WHEN dependent_objects_still_exist THEN NULL;
END $$;
"""


def upgrade() -> None:
    op.add_column("sessions", sa.Column("failure_reason", sa.Text(), nullable=True))
    op.drop_constraint(op.f("ck_sessions_status"), "sessions", type_="check")
    op.create_check_constraint("status", "sessions", f"status IN ({NEW_STATUSES})")
    op.create_table(
        "transcripts",
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("segments_enc", sa.LargeBinary(), nullable=False),
        sa.Column("speaker_roles", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("stt_model", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], name=op.f("fk_transcripts_session_id_sessions")
        ),
        sa.PrimaryKeyConstraint("session_id", name=op.f("pk_transcripts")),
    )
    op.execute(APP_GRANTS_AND_RLS)
    op.execute(WORKER_ROLE)


def downgrade() -> None:
    op.execute(DROP_WORKER)
    op.drop_table("transcripts")
    op.execute("UPDATE sessions SET status = 'uploaded' WHERE status = 'transcribed'")
    op.drop_constraint(op.f("ck_sessions_status"), "sessions", type_="check")
    op.create_check_constraint("status", "sessions", f"status IN ({OLD_STATUSES})")
    op.drop_column("sessions", "failure_reason")
