import os
import re

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models
from database import Base, engine, ensure_runtime_columns
from deps import get_current_user
from hsr_config import APP_NAME
from routers import auth, bookings, challenges, food, members, operations, reports, sessions, settings, staff, tournaments, waitlist

app = FastAPI(title=APP_NAME)
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

protected = [Depends(get_current_user)]

app.include_router(auth.router, prefix="/auth")
app.include_router(sessions.router, prefix="/sessions", dependencies=protected)
app.include_router(members.router, prefix="/members", dependencies=protected)
app.include_router(reports.router, prefix="/reports", dependencies=protected)
app.include_router(settings.router, prefix="/settings", dependencies=protected)
app.include_router(food.router, prefix="/food", dependencies=protected)
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
