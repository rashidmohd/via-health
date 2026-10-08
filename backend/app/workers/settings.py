import time
from typing import Any, ClassVar

from arq import cron
from arq.connections import RedisSettings

from app.core.config import get_settings
from app.core.logging import configure_logging

HEARTBEAT_KEY = "worker:heartbeat"


async def heartbeat(ctx: dict[str, Any]) -> None:
    await ctx["redis"].set(HEARTBEAT_KEY, int(time.time()), ex=120)


async def startup(ctx: dict[str, Any]) -> None:
    configure_logging()


class WorkerSettings:
    # Job payloads carry IDs only, never PHI.
    functions: ClassVar[list[Any]] = []
    cron_jobs: ClassVar[list[Any]] = [cron(heartbeat, second=0)]
    on_startup = startup
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
