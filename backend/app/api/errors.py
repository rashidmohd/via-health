"""API errors are stable codes ({"code": "..."}); the web app translates them (de/en)."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

from app.db.errors import db_error_code


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

    @app.exception_handler(DBAPIError)
    async def _db_error(_request: Request, exc: DBAPIError) -> JSONResponse:
        code = db_error_code(exc)
        if code is None:
            raise exc
        return JSONResponse({"code": code}, status_code=409)
