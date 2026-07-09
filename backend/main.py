import os

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

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
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
