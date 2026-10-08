"""Postgres fixtures. Uses TEST_DATABASE_URL (superuser) if set, otherwise starts a
throwaway local cluster with `initdb` and removes it afterwards."""

import os
import shutil
import socket
import subprocess
import tempfile
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.core.config import Settings

# Tests must not depend on a developer's .env / .env.local (real secrets, prod origins).
# Set before anything creates Settings (app.main does at import).
Settings.model_config["env_file"] = None
from sqlalchemy import Connection, Engine, create_engine, make_url, text
from sqlalchemy.pool import NullPool

from app.adapters.email import EmailSender, get_email_sender
from app.db.session import get_engine, make_engine
from app.main import app
from tests.api_helpers import ORIGIN, FakeEmailSender

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


def _server_engine(url: str) -> Engine:
    """Connection to the maintenance DB, autocommit (for CREATE/DROP DATABASE)."""
    return create_engine(
        make_url(url).set(database="postgres"), isolation_level="AUTOCOMMIT", poolclass=NullPool
    )


@pytest.fixture(scope="session")
def template_db_url(pg_url: str) -> Iterator[str]:
    """A migrated database used as a template for per-test databases."""
    name = "sessio_template"
    server = _server_engine(pg_url)
    with server.connect() as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {name}"))
        c.execute(text(f"CREATE DATABASE {name}"))
    url = make_url(pg_url).set(database=name).render_as_string(hide_password=False)
    command.upgrade(alembic_config(url), "head")
    yield url
    with server.connect() as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
    server.dispose()


@pytest.fixture
def fresh_db_url(template_db_url: str) -> Iterator[str]:
    """An empty, fully migrated database for one test (tests that commit)."""
    name = f"sessio_t_{uuid.uuid4().hex[:12]}"
    server = _server_engine(template_db_url)
    with server.connect() as c:
        c.execute(text(f"CREATE DATABASE {name} TEMPLATE sessio_template"))
    try:
        yield make_url(template_db_url).set(database=name).render_as_string(hide_password=False)
    finally:
        with server.connect() as c:
            c.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
        server.dispose()


@pytest.fixture
def mail() -> FakeEmailSender:
    return FakeEmailSender()


@pytest.fixture
def owner(fresh_db_url: str) -> Iterator[Engine]:
    """Superuser engine on the per-test database (bypasses RLS) for setup and inspection."""
    engine = create_engine(fresh_db_url)
    yield engine
    engine.dispose()


@pytest.fixture
def client(fresh_db_url: str, mail: FakeEmailSender) -> Iterator[TestClient]:
    engine = make_engine(fresh_db_url)
    sender: EmailSender = mail
    app.dependency_overrides[get_engine] = lambda: engine
    app.dependency_overrides[get_email_sender] = lambda: sender
    try:
        with TestClient(app, headers={"Origin": ORIGIN}) as c:
            yield c
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
