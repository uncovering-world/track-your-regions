"""ASVS L2 hardening middleware for the cv-python service.

- BodySizeLimitMiddleware enforces a max request body (V4.1.1 / V5.1.1).
- install_exception_handlers() sanitises exception responses so internal
  details (paths, stack frames) don't leak to callers (V13.4).

The service is internal-only (Docker bridge), but L2 expects defence-in-depth
controls regardless of network topology.
"""

from __future__ import annotations

import os
import sys
import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .utils.image import InvalidImageBytes

# Default cap: 100 MB. Map images can be large; 100 MB still bounds the
# attack surface against unbounded-upload DoS. Override with CV_MAX_BODY_BYTES.
DEFAULT_MAX_BODY_BYTES = 100 * 1024 * 1024


def _max_body_bytes() -> int:
    raw = os.environ.get("CV_MAX_BODY_BYTES", "").strip()
    if not raw:
        return DEFAULT_MAX_BODY_BYTES
    try:
        n = int(raw)
        if n <= 0:
            raise ValueError
        return n
    except ValueError:
        print(
            f"[middleware] Invalid CV_MAX_BODY_BYTES={raw!r}; falling back to default",
            file=sys.stderr,
        )
        return DEFAULT_MAX_BODY_BYTES


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose Content-Length exceeds the configured cap.

    Streaming uploads without Content-Length still flow through; uvicorn's
    own h11 parser caps individual frames, but multi-GB streams without a
    Content-Length should be addressed at the deployment layer (reverse
    proxy / ingress).
    """

    def __init__(self, app, max_bytes: int):
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl is not None:
            try:
                size = int(cl)
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
            if size > self.max_bytes:
                return JSONResponse({"detail": "Request body too large"}, status_code=413)
        return await call_next(request)


def install_exception_handlers(app: FastAPI) -> None:
    """Install exception handlers that log internally but return generic messages.

    Avoids V13.4 information leakage: callers see {"detail":"..."} with a short
    safe string; the full traceback goes to container stdout where operators
    can collect it.
    """

    @app.exception_handler(InvalidImageBytes)
    async def _on_invalid_image(_request: Request, exc: InvalidImageBytes):
        # Safe to surface — the message is intentionally generic ("empty image
        # payload" / "unrecognised image format") and helps the caller fix the
        # request.
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(Exception)
    async def _on_unhandled(_request: Request, exc: Exception):
        traceback.print_exception(type(exc), exc, exc.__traceback__, file=sys.stderr)
        return JSONResponse({"detail": "Internal error"}, status_code=500)


def install_security_middleware(app: FastAPI) -> None:
    """Install all cv-python security middleware in one call."""
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=_max_body_bytes())
    install_exception_handlers(app)
