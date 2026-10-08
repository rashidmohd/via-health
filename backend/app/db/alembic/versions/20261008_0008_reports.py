"""Session reports: AI draft, therapist edits, approval and addenda (plan 0009).

Revision ID: 8f3a6c1d2e47
Revises: 2d7e6b4c9f13
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8f3a6c1d2e47"
down_revision: str | Sequence[str] | None = "2d7e6b4c9f13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REPORT_STATUSES = "'pending', 'drafting', 'draft', 'approved', 'failed', 'no_consent'"

GRANTS_AND_RLS = """
GRANT SELECT, INSERT, UPDATE ON reports TO sessio_app;
GRANT SELECT, INSERT ON report_versions TO sessio_app;

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON reports
    USING (EXISTS (SELECT 1 FROM sessions s
                   WHERE s.id = reports.session_id AND s.user_id = app_current_user_id()));

ALTER TABLE report_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON report_versions
    USING (EXISTS (SELECT 1 FROM reports r JOIN sessions s ON s.id = r.session_id
                   WHERE r.id = report_versions.report_id
                     AND s.user_id = app_current_user_id()));

-- The worker writes drafts and reads confirmed notes; it never sees approved versions.
GRANT SELECT, INSERT, UPDATE ON reports TO sessio_worker;
GRANT SELECT ON captures TO sessio_worker;
CREATE POLICY worker_all ON reports FOR ALL TO sessio_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_read ON captures FOR SELECT TO sessio_worker USING (true);

-- An approved report is read-only; corrections are addenda in report_versions (§630f BGB).
CREATE FUNCTION reports_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'approved' THEN
        RAISE EXCEPTION 'approved report is read-only' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER reports_before_update BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION reports_before_update();

CREATE FUNCTION report_versions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'report versions are append-only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER report_versions_append_only BEFORE UPDATE OR DELETE ON report_versions
    FOR EACH ROW EXECUTE FUNCTION report_versions_append_only();
"""

DROP_EXTRAS = """
DROP POLICY worker_read ON captures;
REVOKE SELECT ON captures FROM sessio_worker;
"""


def upgrade() -> None:
    op.add_column("clients", sa.Column("hidden_names_enc", sa.LargeBinary(), nullable=True))
    op.add_column("sessions", sa.Column("llm_names_enc", sa.LargeBinary(), nullable=True))
    op.create_table(
        "reports",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), server_default="session_note", nullable=False),
        sa.Column("template_code", sa.Text(), nullable=False),
        sa.Column("template_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("pending_field", sa.Text(), nullable=True),
        sa.Column("draft_enc", sa.LargeBinary(), nullable=True),
        sa.Column("content_enc", sa.LargeBinary(), nullable=True),
        sa.Column("llm_model", sa.Text(), nullable=True),
        sa.Column("prompt_version", sa.Text(), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.UUID(), nullable=True),
        sa.CheckConstraint("kind IN ('session_note')", name=op.f("ck_reports_kind")),
        sa.CheckConstraint(f"status IN ({REPORT_STATUSES})", name=op.f("ck_reports_status")),
        sa.CheckConstraint(
            "status <> 'approved' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)",
            name=op.f("ck_reports_approval_complete"),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], ["sessions.id"], name=op.f("fk_reports_session_id_sessions")
        ),
        sa.ForeignKeyConstraint(
            ["approved_by"], ["users.id"], name=op.f("fk_reports_approved_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reports")),
        sa.UniqueConstraint("session_id", "kind", name="uq_reports_session_id_kind"),
    )
    op.create_table(
        "report_versions",
        sa.Column("report_id", sa.UUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("content_enc", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('approval', 'addendum')", name=op.f("ck_report_versions_kind")
        ),
        sa.CheckConstraint("version >= 1", name=op.f("ck_report_versions_version_positive")),
        sa.ForeignKeyConstraint(
            ["report_id"], ["reports.id"], name=op.f("fk_report_versions_report_id_reports")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_report_versions_created_by_users")
        ),
        sa.PrimaryKeyConstraint("report_id", "version", name="pk_report_versions"),
    )
    op.execute(GRANTS_AND_RLS)


def downgrade() -> None:
    op.execute(DROP_EXTRAS)
    op.drop_table("report_versions")
    op.drop_table("reports")
    op.execute("DROP FUNCTION report_versions_append_only()")
    op.execute("DROP FUNCTION reports_before_update()")
    op.drop_column("sessions", "llm_names_enc")
    op.drop_column("clients", "hidden_names_enc")
