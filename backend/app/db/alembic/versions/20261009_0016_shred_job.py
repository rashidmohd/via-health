"""Shred job (plan 0015): the worker may delete keys and stored audio and mark the session
shredded. `audio_state` only moves forward. Additive: grants, policies and a trigger.

Revision ID: 3e6a9c1b5d72
Revises: 5b8d2f4a7c19
Create Date: 2026-10-09
"""

from collections.abc import Sequence

from alembic import op

revision: str = "3e6a9c1b5d72"
down_revision: str | Sequence[str] | None = "5b8d2f4a7c19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = """
GRANT UPDATE (audio_state) ON sessions TO sessio_worker;
GRANT DELETE ON wrapped_keys, object_blobs TO sessio_worker;
CREATE POLICY worker_delete ON wrapped_keys FOR DELETE TO sessio_worker USING (true);
CREATE POLICY worker_delete ON object_blobs FOR DELETE TO sessio_worker USING (true);

-- Deleted audio never comes back: present -> shred_pending -> shredded, never backwards.
CREATE FUNCTION sessions_audio_state_forward() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (OLD.audio_state = 'shred_pending' AND NEW.audio_state = 'present')
        OR (OLD.audio_state = 'shredded' AND NEW.audio_state <> 'shredded')
    THEN
        RAISE EXCEPTION 'audio_not_accepted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER sessions_audio_state_forward BEFORE UPDATE OF audio_state ON sessions
    FOR EACH ROW EXECUTE FUNCTION sessions_audio_state_forward();
"""

DOWNGRADE = """
DROP TRIGGER sessions_audio_state_forward ON sessions;
DROP FUNCTION sessions_audio_state_forward();
DROP POLICY worker_delete ON object_blobs;
DROP POLICY worker_delete ON wrapped_keys;
REVOKE DELETE ON wrapped_keys, object_blobs FROM sessio_worker;
REVOKE UPDATE (audio_state) ON sessions FROM sessio_worker;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
