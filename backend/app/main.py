from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, clients, health, keys, notifications, reports, sessions
from app.api.errors import install_error_handlers
from app.api.origin import origin_check
from app.core.config import get_settings
from app.core.logging import configure_logging


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging()
    app = FastAPI(
        title="Sessio API", docs_url=None if settings.app_env in ("staging", "prod") else "/docs"
    )
    # Order: CORS is added last so it runs first and answers preflight requests.
    app.middleware("http")(origin_check(settings.web_origin))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-Content-SHA256", "X-Segment", "X-Segment-Start-Ms"],
    )
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(clients.router)
    app.include_router(sessions.router)
    app.include_router(reports.router)
    app.include_router(notifications.router)
    app.include_router(keys.router)
    return app


app = create_app()
