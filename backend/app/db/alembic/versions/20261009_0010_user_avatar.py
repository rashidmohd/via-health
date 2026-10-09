"""User avatar settings and profile photo (plan 0012, ADR 0011).

Additive. The photo is small (≤ 300 KB) and stored encrypted under the server data key in the
users row, so row-level security covers it and it goes with the account.

Revision ID: 7b2d9e4f1a63
Revises: 4c9e2a7b5d18
Create Date: 2026-10-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7b2d9e4f1a63"
down_revision: str | Sequence[str] | None = "4c9e2a7b5d18"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("avatar_kind", sa.Text(), server_default="illustrated", nullable=False)
    )
    op.add_column(
        "users",
        sa.Column("avatar_reactions", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "users", sa.Column("avatar_tilt", sa.Boolean(), server_default=sa.false(), nullable=False)
    )
    op.add_column("users", sa.Column("avatar_photo_enc", sa.LargeBinary(), nullable=True))
    op.create_check_constraint(
        "avatar_kind", "users", "avatar_kind IN ('illustrated', 'initials', 'photo')"
    )
    op.create_check_constraint(
        "avatar_photo", "users", "avatar_kind <> 'photo' OR avatar_photo_enc IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_avatar_photo"), "users", type_="check")
    op.drop_constraint(op.f("ck_users_avatar_kind"), "users", type_="check")
    op.drop_column("users", "avatar_photo_enc")
    op.drop_column("users", "avatar_tilt")
    op.drop_column("users", "avatar_reactions")
    op.drop_column("users", "avatar_kind")
