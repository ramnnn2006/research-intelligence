"""Single-owner API access control, not multi-user accounts or isolation.

Configure API_AUTH_TOKEN privately (at least 32 characters). Browsers use their
native HTTP Basic prompt; API_AUTH_USER defaults to researchiq. Scripts can use
Bearer instead. HTTPS is required outside loopback. Browser credentials may be
cached until the browser session closes; revocation requires rotating the key.
"""
import base64
import binascii
import os
import secrets
from fastapi import Request
from fastapi.responses import JSONResponse

_UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
_DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000"


def allowed_origins():
    raw = os.getenv("CORS_ORIGINS", "").strip() or _DEFAULT_ORIGINS
    return [s.strip().rstrip("/") for s in raw.split(",") if s.strip()]


_CHALLENGE = 'Basic realm="ResearchIQ single-owner API", charset="UTF-8"'


def _error(status, detail, challenge=False):
    headers = {"Cache-Control": "no-store"}
    if challenge:
        headers["WWW-Authenticate"] = _CHALLENGE
    return JSONResponse({"detail": detail}, status_code=status, headers=headers)


async def protect_api(request: Request, call_next):
    path = request.url.path
    protected = path == "/api" or path.startswith("/api/") or path in {"/docs", "/redoc", "/openapi.json"}
    if not protected or request.method == "OPTIONS":
        return await call_next(request)
    expected = os.getenv("API_AUTH_TOKEN", "")
    origins = set(allowed_origins())
    if len(expected) < 32 or expected.lower() in {"changeme" * 4, "replace-me" * 4} or "*" in origins:
        return _error(503, "Server access is not configured. Set a private API_AUTH_TOKEN of at least 32 characters and explicit CORS_ORIGINS, then restart.")
    scheme, _, value = request.headers.get("authorization", "").partition(" ")
    scheme = scheme.lower()
    supplied, username = "", ""
    if len(value) <= 4096:
        if scheme == "bearer":
            supplied = value
        elif scheme == "basic":
            try:
                username, separator, supplied = base64.b64decode(value, validate=True).decode("utf-8").partition(":")
                if not separator:
                    supplied = ""
            except (ValueError, UnicodeError, binascii.Error):
                supplied = ""
    valid = bool(supplied) and secrets.compare_digest(supplied.encode(), expected.encode())
    if scheme == "basic":
        valid = secrets.compare_digest(username.encode(), os.getenv("API_AUTH_USER", "researchiq").encode()) and valid
    if not valid:
        return _error(401, "API authentication required.", challenge=True)
    # Basic is ambient browser authority. Require an explicit trusted Origin for
    # mutations, and reject cross-site browser requests even on read routes.
    # CLI clients without an Origin should use Bearer, not disable this check.
    origin = request.headers.get("origin", "").rstrip("/")
    if origin and origin not in origins:
        return _error(403, "This origin is not allowed to access the API.")
    if scheme == "basic" and (request.headers.get("sec-fetch-site") == "cross-site" or (request.method in _UNSAFE and origin not in origins)):
        return _error(403, "Browser API changes require a trusted Origin. Scripts should use Bearer authentication.")
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response
