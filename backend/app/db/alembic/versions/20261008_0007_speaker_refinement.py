"""Speaker accuracy: refinement status and therapist corrections on transcripts (plan 0008).

Revision ID: 2d7e6b4c9f13
Revises: 5b1f9c3a7e28
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2d7e6b4c9f13"
down_revision: str | Sequence[str] | None = "5b1f9c3a7e28"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "transcripts",
        sa.Column("refine_status", sa.Text(), server_default="skipped", nullable=False),
    )
    op.add_column(
        "transcripts",
        sa.Column("speaker_overrides", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_check_constraint(
        "refine_status",
        "transcripts",
        "refine_status IN ('pending', 'running', 'done', 'failed', 'skipped')",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_transcripts_refine_status"), "transcripts", type_="check")
    op.drop_column("transcripts", "speaker_overrides")
    op.drop_column("transcripts", "refine_status")
