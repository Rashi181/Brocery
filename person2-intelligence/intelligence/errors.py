"""Spec rule: any non-200, any endpoint -> {"error": "...", "code": "..."}.

Raise AppError(status, message, code) anywhere in the pipeline; the handlers
registered in dev_server.py / the main app turn it (and FastAPI's own
validation errors) into that exact shape. Nothing else in this codebase
should construct an error response by hand.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from .llm import LLMError


class AppError(Exception):
    def __init__(self, status: int, message: str, code: str) -> None:
        self.status, self.message, self.code = status, message, code
        super().__init__(message)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status, content={"error": exc.message, "code": exc.code}
        )

    @app.exception_handler(HTTPException)
    async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": str(exc.detail), "code": "HTTP_ERROR"},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        msg = (
            f"{loc}: {first.get('msg', 'invalid request')}"
            if loc
            else "invalid request body"
        )
        return JSONResponse(
            status_code=422, content={"error": msg, "code": "VALIDATION_ERROR"}
        )

    @app.exception_handler(LLMError)
    async def _llm_error(_: Request, exc: LLMError) -> JSONResponse:
        return JSONResponse(
            status_code=502,
            content={
                "error": "Meta could not return a usable result. Check your API key, model access and credits, then retry.",
                "code": "LLM_FAILED",
            },
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error. Check the backend terminal and retry.",
                "code": "INTERNAL_ERROR",
            },
        )
