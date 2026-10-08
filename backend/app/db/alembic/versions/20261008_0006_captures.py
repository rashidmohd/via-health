"""Captures: documentation chips per session (plan 0007).

Revision ID: 5b1f9c3a7e28
Revises: 9a4c2e7d1f60
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5b1f9c3a7e28"
down_revision: str | Sequence[str] | None = "9a4c2e7d1f60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GRANTS_AND_RLS = """
GRANT SELECT, INSERT, UPDATE, DELETE ON captures TO sessio_app;

ALTER TABLE captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE captures FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON captures
    USING (EXISTS (SELECT 1 FROM sessions s
                   WHERE s.id = captures.session_id AND s.user_id = app_current_user_id()));
"""


def upgrade() -> None:
    op.create_table(
        "captures",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("at_ms", sa.Integer(), nullable=False),
        sa.Column("payload_enc", sa.LargeBinary(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('action_item', 'date', 'term', 'bookmark')", name=op.f("ck_captures_kind")
        ),
        sa.CheckConstraint(
            "status IN ('suggested', 'confirmed', 'dismissed')", name=op.f("ck_captures_status")
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], name=op.f("fk_captures_session_id_sessions")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_captures")),
        sa.UniqueConstraint("session_id", "key", name="uq_captures_session_id_key"),
    )
    op.create_index(op.f("ix_captures_session_id"), "captures", ["session_id"])
    op.execute(GRANTS_AND_RLS)


def downgrade() -> None:
    op.drop_index(op.f("ix_captures_session_id"), table_name="captures")
    op.drop_table("captures")
