import asyncio
import time
import uuid
from typing import Any, ClassVar

from arq import Retry, cron
from arq.connections import RedisSettings

from app.adapters.kms import get_kms
from app.adapters.storage import make_object_store
from app.adapters.stt import get_stt
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import WORKER_ROLE, make_engine
from app.workers.transcribe import TransientFailure, find_ready, process_session

HEARTBEAT_KEY = "worker:heartbeat"
MAX_TRIES = 3


async def heartbeat(ctx: dict[str, Any]) -> None:
    await ctx["redis"].set(HEARTBEAT_KEY, int(time.time()), ex=120)


async def enqueue_ready_sessions(ctx: dict[str, Any]) -> None:
    """Every 15 s: queue uploaded sessions. The job id makes this safe to repeat."""
    for session_id in await asyncio.to_thread(find_ready, ctx["engine"]):
        await ctx["redis"].enqueue_job(
            "transcribe_session", str(session_id), _job_id=f"transcribe:{session_id}"
        )


async def transcribe_session(ctx: dict[str, Any], session_id: str) -> str:
    # Job payload is the session id only — no PHI in Redis.
    try:
        return await asyncio.to_thread(
            process_session,
            uuid.UUID(session_id),
            engine=ctx["engine"],
            store_for=make_object_store,
            kms=get_kms(),
            stt=get_stt(),
            last_attempt=ctx["job_try"] >= MAX_TRIES,
        )
    except TransientFailure:
        raise Retry(defer=60 * ctx["job_try"]) from None


async def startup(ctx: dict[str, Any]) -> None:
    configure_logging()
    ctx["engine"] = make_engine(get_settings().database_url, role=WORKER_ROLE)


async def shutdown(ctx: dict[str, Any]) -> None:
    ctx["engine"].dispose()


class WorkerSettings:
    functions: ClassVar[list[Any]] = [transcribe_session]
    cron_jobs: ClassVar[list[Any]] = [
        cron(heartbeat, second=0),
        cron(enqueue_ready_sessions, second={0, 15, 30, 45}),
    ]
    on_startup = startup
    on_shutdown = shutdown
    max_tries = MAX_TRIES
    job_timeout = 45 * 60
    keep_result = 60
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
