"""Therapist keys (plan 0014 step A): the four key columns are set together, and only once.
Additive: a check constraint and a trigger on existing columns.

Revision ID: 4a7e1c9d3b26
Revises: 9d4f7b2c6e15
Create Date: 2026-10-09
"""

from collections.abc import Sequence

from alembic import op

revision: str = "4a7e1c9d3b26"
down_revision: str | Sequence[str] | None = "9d4f7b2c6e15"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KEYS_COMPLETE = (
    "(pgp_public_key IS NULL) = (pgp_private_key_enc IS NULL)"
    " AND (pgp_public_key IS NULL) = (recovery_public_key IS NULL)"
    " AND (pgp_public_key IS NULL) = (key_fingerprints IS NULL)"
)

WRITE_ONCE = """
CREATE FUNCTION users_keys_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.pgp_public_key IS NOT NULL AND (
        NEW.pgp_public_key IS DISTINCT FROM OLD.pgp_public_key
        OR NEW.pgp_private_key_enc IS DISTINCT FROM OLD.pgp_private_key_enc
        OR NEW.recovery_public_key IS DISTINCT FROM OLD.recovery_public_key
        OR NEW.key_fingerprints IS DISTINCT FROM OLD.key_fingerprints
    ) THEN
        RAISE EXCEPTION 'keys_immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER users_keys_write_once
    BEFORE UPDATE OF pgp_public_key, pgp_private_key_enc, recovery_public_key, key_fingerprints
    ON users FOR EACH ROW EXECUTE FUNCTION users_keys_write_once();
"""


def upgrade() -> None:
    op.create_check_constraint("keys_complete", "users", KEYS_COMPLETE)
    op.execute(WRITE_ONCE)


def downgrade() -> None:
    op.execute("DROP TRIGGER users_keys_write_once ON users")
    op.execute("DROP FUNCTION users_keys_write_once()")
    op.drop_constraint(op.f("ck_users_keys_complete"), "users", type_="check")
