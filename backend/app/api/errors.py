"""API errors are stable codes ({"code": "..."}); the web app translates them (de/en)."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

from app.adapters.kms import KmsUnavailable
from app.db.errors import db_error_code

logger = logging.getLogger("sessio.api")


class ApiError(Exception):
    def __init__(self, code: str, status_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"code": exc.code}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _invalid_input(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        # Do not echo the input back: it may contain personal data.
        return JSONResponse({"code": "invalid_input"}, status_code=422)

    @app.exception_handler(KmsUnavailable)
    async def _kms_unavailable(_request: Request, exc: KmsUnavailable) -> JSONResponse:
        logger.error("key service call failed: %s", exc)  # exception type only, no key data
        return JSONResponse({"code": "key_service_unavailable"}, status_code=503)

    @app.exception_handler(DBAPIError)
    async def _db_error(_request: Request, exc: DBAPIError) -> JSONResponse:
        code = db_error_code(exc)
        if code is None:
            raise exc
        return JSONResponse({"code": code}, status_code=409)
