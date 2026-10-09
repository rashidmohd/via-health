"""Turns left out of the AI draft: times only, the text stays in the record (ADR 0018).

Revision ID: 7c3a9e5d1f40
Revises: 4a7e1c9d3b26
Create Date: 2026-10-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "7c3a9e5d1f40"
down_revision: str | Sequence[str] | None = "4a7e1c9d3b26"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "transcripts",
        sa.Column("excluded_ranges", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("transcripts", "excluded_ranges")
