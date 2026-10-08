from alembic import command

from tests.conftest import alembic_config


def test_models_match_migrations(migrated_url: str) -> None:
    command.check(alembic_config(migrated_url))


def test_downgrade_and_upgrade_roundtrip(migrated_url: str) -> None:
    cfg = alembic_config(migrated_url)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
