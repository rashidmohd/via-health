"""Email-code login: login codes, auth sessions, pre-login lookup functions.

See docs/plans/0002-login.md and docs/adr/0003-email-code-login-resend.md.

Revision ID: 48cefb78b94a
Revises: 835036395acb
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "48cefb78b94a"
down_revision: str | Sequence[str] | None = "835036395acb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GRANTS_AND_RLS = """
GRANT SELECT, INSERT, UPDATE, DELETE ON login_codes TO sessio_app;
GRANT SELECT, INSERT, UPDATE ON auth_sessions TO sessio_app;

ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON auth_sessions
    USING (user_id = app_current_user_id())
    WITH CHECK (user_id = app_current_user_id());
"""

# Before login the user is unknown, so RLS would hide every row. These two functions are the
# only RLS bypass: each returns a single user id and nothing else. They must be owned by a
# role that bypasses RLS (the migration owner / superuser).
PRE_LOGIN_FUNCTIONS = """
CREATE FUNCTION auth_user_id_by_email(p_email text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT id FROM users WHERE email = lower(p_email)
$$;

-- Valid session: not revoked, not expired, used within the last 2 hours. Touches last_seen_at.
CREATE FUNCTION auth_session_user(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user_id uuid;
BEGIN
    UPDATE auth_sessions SET last_seen_at = now()
    WHERE token_hash = p_token_hash
      AND revoked_at IS NULL
      AND expires_at > now()
      AND last_seen_at > now() - interval '2 hours'
    RETURNING user_id INTO v_user_id;
    RETURN v_user_id;
END $$;

REVOKE ALL ON FUNCTION auth_user_id_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_session_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_user_id_by_email(text) TO sessio_app;
GRANT EXECUTE ON FUNCTION auth_session_user(text) TO sessio_app;
"""


def upgrade() -> None:
    op.create_check_constraint("email_lowercase", "users", "email = lower(email)")
    op.create_table(
        "login_codes",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("email_hash", sa.Text(), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("ip_hash", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_login_codes")),
    )
    op.create_index(op.f("ix_login_codes_email_hash"), "login_codes", ["email_hash"])
    op.create_index(op.f("ix_login_codes_ip_hash"), "login_codes", ["ip_hash"])
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "expires_at <= created_at + interval '12 hours'",
            name=op.f("ck_auth_sessions_max_lifetime"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_auth_sessions_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_auth_sessions_token_hash")),
    )
    op.create_index(op.f("ix_auth_sessions_user_id"), "auth_sessions", ["user_id"])
    op.execute(GRANTS_AND_RLS)
    op.execute(PRE_LOGIN_FUNCTIONS)


def downgrade() -> None:
    op.execute("DROP FUNCTION auth_session_user(text)")
    op.execute("DROP FUNCTION auth_user_id_by_email(text)")
    op.drop_index(op.f("ix_auth_sessions_user_id"), table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index(op.f("ix_login_codes_ip_hash"), table_name="login_codes")
    op.drop_index(op.f("ix_login_codes_email_hash"), table_name="login_codes")
    op.drop_table("login_codes")
    op.drop_constraint(op.f("ck_users_email_lowercase"), "users", type_="check")
