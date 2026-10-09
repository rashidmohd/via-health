"""Drawn avatar from the user's photo: appearance description only (ADR 0013). Additive.

Revision ID: 9d4f7b2c6e15
Revises: 2e8c5a1f9b04
Create Date: 2026-10-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "9d4f7b2c6e15"
down_revision: str | Sequence[str] | None = "2e8c5a1f9b04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("avatar_appearance", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.drop_constraint(op.f("ck_users_avatar_kind"), "users", type_="check")
    op.create_check_constraint(
        "avatar_kind", "users", "avatar_kind IN ('illustrated', 'drawn', 'initials', 'photo')"
    )
    op.create_check_constraint(
        "avatar_drawn", "users", "avatar_kind <> 'drawn' OR avatar_appearance IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("UPDATE users SET avatar_kind = 'illustrated' WHERE avatar_kind = 'drawn'")
    op.drop_constraint(op.f("ck_users_avatar_drawn"), "users", type_="check")
    op.drop_constraint(op.f("ck_users_avatar_kind"), "users", type_="check")
    op.create_check_constraint(
        "avatar_kind", "users", "avatar_kind IN ('illustrated', 'initials', 'photo')"
    )
    op.drop_column("users", "avatar_appearance")
