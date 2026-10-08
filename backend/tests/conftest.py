"""Postgres fixtures. Uses TEST_DATABASE_URL (superuser) if set, otherwise starts a
throwaway local cluster with `initdb` and removes it afterwards."""

import os
import shutil
import socket
import subprocess
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, Engine, create_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port: int = s.getsockname()[1]
        return port


def _start_cluster(data_dir: Path, port: int) -> None:
    subprocess.run(
        [
            "initdb",
            "-D",
            str(data_dir),
            "-U",
            "postgres",
            "-A",
            "trust",
            "-E",
            "UTF8",
            "--locale=C",
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            "pg_ctl",
            "-D",
            str(data_dir),
            "-l",
            str(data_dir / "log"),
            "-w",
            "-o",
            f"-k '' -p {port} -c listen_addresses=127.0.0.1 -c fsync=off",
            "start",
        ],
        check=True,
        capture_output=True,
    )
    for _ in range(50):
        if (
            subprocess.run(
                ["pg_isready", "-h", "127.0.0.1", "-p", str(port)], capture_output=True
            ).returncode
            == 0
        ):
            return
        time.sleep(0.1)
    raise RuntimeError("test postgres did not start")


@pytest.fixture(scope="session")
def pg_url() -> Iterator[str]:
    if url := os.environ.get("TEST_DATABASE_URL"):
        yield url
        return
    if shutil.which("initdb") is None:
        pytest.skip("initdb not found and TEST_DATABASE_URL not set")
    data_dir = Path(tempfile.mkdtemp(prefix="sessio-pg-"))
    port = _free_port()
    _start_cluster(data_dir, port)
    try:
        subprocess.run(
            ["createdb", "-h", "127.0.0.1", "-p", str(port), "-U", "postgres", "sessio_test"],
            check=True,
            capture_output=True,
        )
        yield f"postgresql+psycopg://postgres@127.0.0.1:{port}/sessio_test"
    finally:
        subprocess.run(
            ["pg_ctl", "-D", str(data_dir), "-m", "immediate", "stop"], capture_output=True
        )
        shutil.rmtree(data_dir, ignore_errors=True)


def alembic_config(url: str) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


@pytest.fixture(scope="session")
def migrated_url(pg_url: str) -> str:
    command.upgrade(alembic_config(pg_url), "head")
    return pg_url


@pytest.fixture(scope="session")
def owner_engine(migrated_url: str) -> Iterator[Engine]:
    engine = create_engine(migrated_url)
    yield engine
    engine.dispose()


@pytest.fixture
def conn(owner_engine: Engine) -> Iterator[Connection]:
    """One transaction per test, always rolled back. Starts as the (superuser) owner."""
    with owner_engine.connect() as connection:
        transaction = connection.begin()
        try:
            yield connection
        finally:
            transaction.rollback()
