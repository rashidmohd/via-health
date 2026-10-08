"""Recorder step A: session mime type and interim encrypted object storage.

See docs/plans/0004-recorder-step-a.md.

Revision ID: 7c2f4a9e0b31
Revises: 48cefb78b94a
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7c2f4a9e0b31"
down_revision: str | Sequence[str] | None = "48cefb78b94a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GRANTS_AND_RLS = """
GRANT SELECT, INSERT, DELETE ON object_blobs TO sessio_app;

ALTER TABLE object_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_blobs FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON object_blobs
    USING (EXISTS (SELECT 1 FROM sessions s
                   WHERE s.id = object_blobs.session_id AND s.user_id = app_current_user_id()));
"""


def upgrade() -> None:
    op.add_column("sessions", sa.Column("mime_type", sa.Text(), nullable=True))
    op.create_table(
        "object_blobs",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], name=op.f("fk_object_blobs_session_id_sessions")
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_object_blobs")),
    )
    op.create_index(op.f("ix_object_blobs_session_id"), "object_blobs", ["session_id"])
    op.execute(GRANTS_AND_RLS)


def downgrade() -> None:
    op.drop_index(op.f("ix_object_blobs_session_id"), table_name="object_blobs")
    op.drop_table("object_blobs")
    op.drop_column("sessions", "mime_type")
