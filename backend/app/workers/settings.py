import asyncio
import time
import uuid
from typing import Any, ClassVar

from arq import Retry, cron, func
from arq.connections import RedisSettings

from app.adapters.kms import get_kms
from app.adapters.llm import LlmError, get_llm
from app.adapters.storage import make_object_store
from app.adapters.stt import get_stt
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import WORKER_ROLE, make_engine
from app.workers.report import draft_report, draft_report_unconfigured, find_draft_work
from app.workers.transcribe import (
    TransientFailure,
    find_ready,
    find_refine_work,
    find_window_work,
    process_session,
    process_windows,
    refine_speakers,
)

HEARTBEAT_KEY = "worker:heartbeat"
MAX_TRIES = 3
WINDOW_ERROR_PAUSE_S = 300  # after a window error, wait before trying that session again


async def heartbeat(ctx: dict[str, Any]) -> None:
    await ctx["redis"].set(HEARTBEAT_KEY, int(time.time()), ex=120)


async def enqueue_ready_sessions(ctx: dict[str, Any]) -> None:
    """Every 15 s: queue uploaded sessions and recording sessions with a new window of audio.
    Job ids make this safe to repeat (one job per session and kind at a time)."""
    redis = ctx["redis"]
    for session_id in await asyncio.to_thread(find_ready, ctx["engine"]):
        await redis.enqueue_job(
            "transcribe_session", str(session_id), _job_id=f"transcribe:{session_id}"
        )
    for session_id in await asyncio.to_thread(find_refine_work, ctx["engine"]):
        await redis.enqueue_job(
            "refine_session_speakers", str(session_id), _job_id=f"refine:{session_id}"
        )
    for session_id in await asyncio.to_thread(find_draft_work, ctx["engine"]):
        await redis.enqueue_job(
            "draft_session_report", str(session_id), _job_id=f"report:{session_id}"
        )
    for session_id in await asyncio.to_thread(find_window_work, ctx["engine"]):
        if await redis.exists(f"windows-paused:{session_id}"):
            continue
        await redis.enqueue_job(
            "transcribe_windows", str(session_id), _job_id=f"windows:{session_id}"
        )


async def refine_session_speakers(ctx: dict[str, Any], session_id: str) -> str:
    try:
        return await asyncio.to_thread(
            refine_speakers,
            uuid.UUID(session_id),
            engine=ctx["engine"],
            store_for=make_object_store,
            kms=get_kms(),
            stt=get_stt(),
            last_attempt=ctx["job_try"] >= MAX_TRIES,
        )
    except TransientFailure:
        raise Retry(defer=60 * ctx["job_try"]) from None


async def draft_session_report(ctx: dict[str, Any], session_id: str) -> str:
    try:
        llm = get_llm()
    except LlmError:
        llm = None
    if llm is None:
        return await asyncio.to_thread(
            draft_report_unconfigured, ctx["engine"], uuid.UUID(session_id)
        )
    try:
        return await asyncio.to_thread(
            draft_report,
            uuid.UUID(session_id),
            engine=ctx["engine"],
            llm=llm,
            last_attempt=ctx["job_try"] >= MAX_TRIES,
        )
    except TransientFailure:
        raise Retry(defer=60 * ctx["job_try"]) from None


async def transcribe_windows(ctx: dict[str, Any], session_id: str) -> str:
    result = await asyncio.to_thread(
        process_windows,
        uuid.UUID(session_id),
        engine=ctx["engine"],
        store_for=make_object_store,
        kms=get_kms(),
        stt=get_stt(),
    )
    if result == "error":
        await ctx["redis"].set(f"windows-paused:{session_id}", 1, ex=WINDOW_ERROR_PAUSE_S)
    return result


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
    # keep_result=0: the job id is free again right after the job, so the next window or a
    # retry can be queued without waiting.
    functions: ClassVar[list[Any]] = [
        func(transcribe_session, keep_result=0),
        func(transcribe_windows, keep_result=0, max_tries=1),
        func(refine_session_speakers, keep_result=0),
        func(draft_session_report, keep_result=0),
    ]
    cron_jobs: ClassVar[list[Any]] = [
        cron(heartbeat, second=0),
        cron(enqueue_ready_sessions, second={0, 15, 30, 45}),
    ]
    on_startup = startup
    on_shutdown = shutdown
    max_tries = MAX_TRIES
    job_timeout = 45 * 60
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
