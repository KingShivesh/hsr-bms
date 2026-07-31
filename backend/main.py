import logging
import os
import re
import time
import uuid

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

import models
from database import Base, engine, ensure_runtime_columns
from deps import get_current_user
from hsr_config import APP_NAME, is_production_env, validate_runtime_config
from routers import auth, bookings, challenges, food, inventory, members, operations, reports, sessions, settings, staff, tournaments, waitlist

validate_runtime_config()
MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(1024 * 1024)))
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("hsr-bms")

app = FastAPI(
    title=APP_NAME,
    docs_url=None if is_production_env() else "/docs",
    redoc_url=None if is_production_env() else "/redoc",
    openapi_url=None if is_production_env() else "/openapi.json",
)
Base.metadata.create_all(bind=engine)
ensure_runtime_columns()

def cors_settings():
    configured = [
        origin.strip()
        for origin in os.getenv(
            "ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,https://*.vercel.app",
        ).split(",")
        if origin.strip()
    ]
    exact_origins = []
    wildcard_patterns = []
    for origin in configured:
        if "*" in origin:
            wildcard_patterns.append("^" + re.escape(origin).replace("\\*", ".*") + "$")
        else:
            exact_origins.append(origin)
    return exact_origins, "|".join(wildcard_patterns) or None


allowed_origins, allowed_origin_regex = cors_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    request_id = request.headers.get("x-client-request-id") or str(uuid.uuid4())
    started_at = time.perf_counter()
    content_length = request.headers.get("content-length")
    try:
        request_bytes = int(content_length or "0")
    except ValueError:
        request_bytes = 0
    if request_bytes > MAX_REQUEST_BYTES:
        response = JSONResponse(
            status_code=413,
            content={"detail": "Request body too large"},
        )
        response.headers["X-Request-Id"] = request_id
        return response
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = round((time.perf_counter() - started_at) * 1000)
        logger.exception(
            "request_id=%s method=%s path=%s status=500 duration_ms=%s",
            request_id,
            request.method,
            request.url.path,
            elapsed_ms,
        )
        response = JSONResponse(
            status_code=500,
            content={
                "detail": "Internal server error",
                "request_id": request_id,
            },
        )
    elapsed_ms = round((time.perf_counter() - started_at) * 1000)
    response.headers["X-Request-Id"] = request_id
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
    )
    if request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https":
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
    logger.info(
        "request_id=%s method=%s path=%s status=%s duration_ms=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


protected = [Depends(get_current_user)]

app.include_router(auth.router, prefix="/auth")
app.include_router(sessions.router, prefix="/sessions", dependencies=protected)
app.include_router(members.router, prefix="/members", dependencies=protected)
app.include_router(reports.router, prefix="/reports", dependencies=protected)
app.include_router(settings.router, prefix="/settings", dependencies=protected)
app.include_router(food.router, prefix="/food", dependencies=protected)
app.include_router(inventory.router, prefix="/inventory", dependencies=protected)
app.include_router(operations.router, prefix="/operations", dependencies=protected)
app.include_router(tournaments.router, prefix="/tournaments", dependencies=protected)
app.include_router(waitlist.router, prefix="/waitlist", dependencies=protected)
app.include_router(bookings.router, prefix="/bookings", dependencies=protected)
app.include_router(staff.router, prefix="/staff", dependencies=protected)
app.include_router(challenges.router, prefix="/challenges", dependencies=protected)


@app.get("/")
def root():
    return {"status": f"{APP_NAME} running"}


@app.get("/health")
def health():
    return {"status": "ok", "service": APP_NAME}


@app.get("/ready")
def ready():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        logger.exception("database readiness check failed")
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "service": APP_NAME, "database": "error"},
        )
    return {"status": "ok", "service": APP_NAME, "database": "ok"}
