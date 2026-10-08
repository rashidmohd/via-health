"""CSRF protection: state-changing requests must come from the web app's origin."""

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def origin_check(allowed_origin: str) -> Callable[..., Awaitable[Response]]:
    async def middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.method not in SAFE_METHODS and request.headers.get("origin") != allowed_origin:
            return JSONResponse({"code": "origin_not_allowed"}, status_code=403)
        return await call_next(request)

    return middleware
