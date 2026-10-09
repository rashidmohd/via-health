"""Signed session notes (plan 0014 step B, rule 7).

A signed note, its transcript and a small index are OpenPGP messages made in the browser and
encrypted to the therapist and recovery keys. The server stores them as armored text and drops
its own readable copies in the same transaction. Additive: new columns, a new status, nullable
`*_enc` columns, and a one-way "seal" exception in the read-only triggers.

Revision ID: 5b8d2f4a7c19
Revises: 7c3a9e5d1f40
Create Date: 2026-10-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "5b8d2f4a7c19"
down_revision: str | Sequence[str] | None = "7c3a9e5d1f40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_STATUSES = "'pending', 'drafting', 'draft', 'approved', 'failed', 'no_consent'"
NEW_STATUSES = f"{OLD_STATUSES}, 'signed'"

SIGNED_COMPLETE = (
    "status <> 'signed' OR ("
    "signed_at IS NOT NULL AND signer_fingerprint IS NOT NULL AND encrypted_to IS NOT NULL"
    " AND index_pgp IS NOT NULL AND approved_at IS NOT NULL AND approved_by IS NOT NULL"
    " AND content_enc IS NULL AND draft_enc IS NULL)"
)
ONE_FORM = "(content_enc IS NULL) <> (pgp_message IS NULL)"
PGP_COMPLETE = (
    "pgp_message IS NULL OR (signer_fingerprint IS NOT NULL AND encrypted_to IS NOT NULL)"
)
TRANSCRIPT_ON_APPROVAL = "transcript_pgp IS NULL OR kind = 'approval'"

TRIGGERS = """
-- Approved notes stay read-only. The one change allowed is sealing: approved -> signed
-- (notes approved before signing existed). A signed note never changes again.
CREATE OR REPLACE FUNCTION reports_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'signed' THEN
        RAISE EXCEPTION 'signed report is read-only' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'approved' AND (
        NEW.status <> 'signed'
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
        OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    ) THEN
        RAISE EXCEPTION 'approved report is read-only' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

-- Append-only, except sealing: a server-encrypted version may be replaced once by its
-- signed form (content_enc -> pgp_message). Nothing else about the row may change.
CREATE OR REPLACE FUNCTION report_versions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE'
        AND OLD.pgp_message IS NULL AND NEW.pgp_message IS NOT NULL AND NEW.content_enc IS NULL
        AND NEW.report_id = OLD.report_id AND NEW.version = OLD.version
        AND NEW.kind = OLD.kind AND NEW.created_at = OLD.created_at
        AND NEW.created_by = OLD.created_by
    THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'report versions are append-only' USING ERRCODE = 'check_violation';
END $$;

-- Once the transcript is signed the server copy is gone (segments_enc NULL) for good.
CREATE FUNCTION transcripts_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.segments_enc IS NULL THEN
        RAISE EXCEPTION 'record_signed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER transcripts_sealed BEFORE UPDATE ON transcripts
    FOR EACH ROW EXECUTE FUNCTION transcripts_sealed();

GRANT UPDATE (content_enc, pgp_message, transcript_pgp, signer_fingerprint, encrypted_to)
    ON report_versions TO sessio_app;
GRANT DELETE ON transcript_windows TO sessio_app;
"""

DOWNGRADE_TRIGGERS = """
REVOKE DELETE ON transcript_windows FROM sessio_app;
REVOKE UPDATE (content_enc, pgp_message, transcript_pgp, signer_fingerprint, encrypted_to)
    ON report_versions FROM sessio_app;
DROP TRIGGER transcripts_sealed ON transcripts;
DROP FUNCTION transcripts_sealed();

CREATE OR REPLACE FUNCTION reports_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'approved' THEN
        RAISE EXCEPTION 'approved report is read-only' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION report_versions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'report versions are append-only' USING ERRCODE = 'check_violation';
END $$;
"""


def upgrade() -> None:
    op.add_column("reports", sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reports", sa.Column("signer_fingerprint", sa.Text(), nullable=True))
    op.add_column(
        "reports",
        sa.Column("encrypted_to", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column("reports", sa.Column("index_pgp", sa.Text(), nullable=True))
    op.drop_constraint(op.f("ck_reports_status"), "reports", type_="check")
    op.create_check_constraint("status", "reports", f"status IN ({NEW_STATUSES})")
    op.create_check_constraint("signed_complete", "reports", SIGNED_COMPLETE)

    op.alter_column("report_versions", "content_enc", nullable=True)
    op.add_column("report_versions", sa.Column("pgp_message", sa.Text(), nullable=True))
    op.add_column("report_versions", sa.Column("transcript_pgp", sa.Text(), nullable=True))
    op.add_column("report_versions", sa.Column("signer_fingerprint", sa.Text(), nullable=True))
    op.add_column(
        "report_versions",
        sa.Column("encrypted_to", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_check_constraint("one_form", "report_versions", ONE_FORM)
    op.create_check_constraint("pgp_complete", "report_versions", PGP_COMPLETE)
    op.create_check_constraint("transcript_on_approval", "report_versions", TRANSCRIPT_ON_APPROVAL)

    op.alter_column("transcripts", "segments_enc", nullable=True)
    op.execute(TRIGGERS)


def downgrade() -> None:
    # Fails while signed records exist: their server copies are gone and cannot be restored.
    op.execute(DOWNGRADE_TRIGGERS)
    op.alter_column("transcripts", "segments_enc", nullable=False)

    op.drop_constraint(
        op.f("ck_report_versions_transcript_on_approval"), "report_versions", type_="check"
    )
    op.drop_constraint(op.f("ck_report_versions_pgp_complete"), "report_versions", type_="check")
    op.drop_constraint(op.f("ck_report_versions_one_form"), "report_versions", type_="check")
    op.drop_column("report_versions", "encrypted_to")
    op.drop_column("report_versions", "signer_fingerprint")
    op.drop_column("report_versions", "transcript_pgp")
    op.drop_column("report_versions", "pgp_message")
    op.alter_column("report_versions", "content_enc", nullable=False)

    op.drop_constraint(op.f("ck_reports_signed_complete"), "reports", type_="check")
    op.drop_constraint(op.f("ck_reports_status"), "reports", type_="check")
    op.create_check_constraint("status", "reports", f"status IN ({OLD_STATUSES})")
    op.drop_column("reports", "index_pgp")
    op.drop_column("reports", "encrypted_to")
    op.drop_column("reports", "signer_fingerprint")
    op.drop_column("reports", "signed_at")
