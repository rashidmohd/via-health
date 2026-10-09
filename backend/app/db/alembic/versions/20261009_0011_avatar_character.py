"""Choice of three ready-made avatar characters (ADR 0012). Additive.

Revision ID: 2e8c5a1f9b04
Revises: 7b2d9e4f1a63
Create Date: 2026-10-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "2e8c5a1f9b04"
down_revision: str | Sequence[str] | None = "7b2d9e4f1a63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("avatar_character", sa.Integer(), server_default="0", nullable=False)
    )
    op.create_check_constraint("avatar_character", "users", "avatar_character BETWEEN 0 AND 2")


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_avatar_character"), "users", type_="check")
    op.drop_column("users", "avatar_character")
