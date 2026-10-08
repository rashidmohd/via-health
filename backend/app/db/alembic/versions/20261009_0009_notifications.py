"""Notifications: background events for the therapist (plan 0010).

Rows hold ids and a kind code only, never names or text.

Revision ID: 4c9e2a7b5d18
Revises: 8f3a6c1d2e47
Create Date: 2026-10-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "4c9e2a7b5d18"
down_revision: str | Sequence[str] | None = "8f3a6c1d2e47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = (
    "'transcript_ready', 'transcription_failed', 'report_ready', 'report_failed', "
    "'report_no_consent'"
)

GRANTS_AND_RLS = """
GRANT SELECT ON notifications TO sessio_app;
GRANT UPDATE (read_at) ON notifications TO sessio_app;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON notifications USING (user_id = app_current_user_id());

-- The worker writes events but cannot read them back.
GRANT INSERT ON notifications TO sessio_worker;
CREATE POLICY worker_insert ON notifications FOR INSERT TO sessio_worker WITH CHECK (true);
"""


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"kind IN ({KINDS})", name=op.f("ck_notifications_kind")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_notifications_user_id_users")
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], name=op.f("fk_notifications_session_id_sessions")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
    )
    op.create_index(
        "ix_notifications_user_id_created_at", "notifications", ["user_id", "created_at"]
    )
    op.execute(GRANTS_AND_RLS)


def downgrade() -> None:
    op.drop_index("ix_notifications_user_id_created_at", table_name="notifications")
    op.drop_table("notifications")
