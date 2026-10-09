"""Chunk segments (ADR 0022): a reconnected microphone starts a new MediaRecorder file within
the same session. Additive: two columns with defaults, existing rows are segment 0.

Revision ID: 8c4e1f7a2b90
Revises: 3e6a9c1b5d72
Create Date: 2026-10-09
"""

from collections.abc import Sequence

from alembic import op

revision: str = "8c4e1f7a2b90"
down_revision: str | Sequence[str] | None = "3e6a9c1b5d72"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UPGRADE = """
ALTER TABLE audio_chunks
    ADD COLUMN segment integer NOT NULL DEFAULT 0,
    ADD COLUMN segment_start_ms integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_audio_chunks_segment_non_negative
        CHECK (segment >= 0 AND segment_start_ms >= 0);
"""

DOWNGRADE = """
ALTER TABLE audio_chunks
    DROP CONSTRAINT ck_audio_chunks_segment_non_negative,
    DROP COLUMN segment_start_ms,
    DROP COLUMN segment;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
