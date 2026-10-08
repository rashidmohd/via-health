"""Transcript windows: transcription while the session is recording.

See docs/plans/0006-transcribe-during-session.md.

Revision ID: 9a4c2e7d1f60
Revises: 3e8d1b6f5a42
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9a4c2e7d1f60"
down_revision: str | Sequence[str] | None = "3e8d1b6f5a42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GRANTS_AND_RLS = """
GRANT SELECT ON transcript_windows TO sessio_app;
GRANT SELECT, INSERT, DELETE ON transcript_windows TO sessio_worker;

ALTER TABLE transcript_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON transcript_windows
    USING (EXISTS (SELECT 1 FROM sessions s
                   WHERE s.id = transcript_windows.session_id
                     AND s.user_id = app_current_user_id()));
CREATE POLICY worker_all ON transcript_windows FOR ALL TO sessio_worker
    USING (true) WITH CHECK (true);
"""


def upgrade() -> None:
    op.create_table(
        "transcript_windows",
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("idx", sa.Integer(), nullable=False),
        sa.Column("start_ms", sa.Integer(), nullable=False),
        sa.Column("end_ms", sa.Integer(), nullable=False),
        sa.Column("words_enc", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], name=op.f("fk_transcript_windows_session_id_sessions")
        ),
        sa.PrimaryKeyConstraint("session_id", "idx", name="pk_transcript_windows"),
    )
    op.execute(GRANTS_AND_RLS)


def downgrade() -> None:
    op.drop_table("transcript_windows")
