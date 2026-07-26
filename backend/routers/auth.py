import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from deps import create_token, get_current_claims, hash_password, require_admin, upgrade_password_if_plain, verify_password
import models

router = APIRouter()
DEFAULT_STAFF_USERNAME = "staff"
DEFAULT_STAFF_PASSWORD = "staff123"
MAX_LOGIN_FAILURES = 5
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_LOCK_SECONDS = 10 * 60
_login_failures: dict[str, list[float]] = {}


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


class ChangeAuthRequest(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=128)


def login_key(request: Request, username: str) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded_for.split(",", 1)[0].strip()
    if not client_ip and request.client:
        client_ip = request.client.host
    return f"{client_ip or 'unknown'}:{username.strip().lower()}"


def assert_login_allowed(request: Request, username: str) -> str:
    key = login_key(request, username)
    now = time.time()
    recent = [
        ts for ts in _login_failures.get(key, [])
        if now - ts < LOGIN_WINDOW_SECONDS
    ]
    _login_failures[key] = recent
    if len(recent) >= MAX_LOGIN_FAILURES:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Try again in 10 minutes.",
            headers={"Retry-After": str(LOGIN_LOCK_SECONDS)},
        )
    return key


def record_login_failure(key: str) -> None:
    _login_failures.setdefault(key, []).append(time.time())


def clear_login_failures(key: str) -> None:
    _login_failures.pop(key, None)


def get_or_create_settings(db: Session) -> models.Settings:
    settings = db.query(models.Settings).first()
    if settings:
        return settings
    settings = models.Settings()
    db.add(settings)
    db.flush()
    return settings


def upgrade_staff_password_if_plain(db: Session, settings: models.Settings, plain: str) -> None:
    staff_password = getattr(settings, "staff_password", "")
    if staff_password and not (staff_password.startswith("$2b$") or staff_password.startswith("$2a$")):
        settings.staff_password = hash_password(plain)
        db.commit()


def ensure_staff_credentials(db: Session, settings: models.Settings) -> tuple[str, str]:
    changed = False
    staff_username = (getattr(settings, "staff_username", "") or "").strip()
    staff_password = getattr(settings, "staff_password", "") or ""

    if not staff_username:
        staff_username = DEFAULT_STAFF_USERNAME
        settings.staff_username = staff_username
        changed = True

    if not staff_password:
        staff_password = hash_password(DEFAULT_STAFF_PASSWORD)
        settings.staff_password = staff_password
        changed = True

    if changed:
        db.commit()

    return staff_username, staff_password


@router.post("/login")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    settings = get_or_create_settings(db)
    username = body.username.strip()
    password = body.password
    attempt_key = assert_login_allowed(request, username)

    if username == settings.username and verify_password(password, settings.password):
        upgrade_password_if_plain(db, settings, password)
        clear_login_failures(attempt_key)
        return {
            "token": create_token(username, "admin"),
            "role": "admin",
            "username": username,
        }

    staff_username, staff_password = ensure_staff_credentials(db, settings)
    if username == staff_username and verify_password(password, staff_password):
        upgrade_staff_password_if_plain(db, settings, password)
        clear_login_failures(attempt_key)
        return {
            "token": create_token(username, "staff"),
            "role": "staff",
            "username": username,
        }

    record_login_failure(attempt_key)
    raise HTTPException(status_code=401, detail="Invalid username or password")


@router.get("/me")
def me(claims: dict = Depends(get_current_claims)):
    return claims


@router.post("/change")
def change_auth(
    body: ChangeAuthRequest,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    username = body.username.strip()
    password = body.password.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")

    settings = get_or_create_settings(db)

    settings.username = username
    settings.password = hash_password(password)
    db.commit()
    return {"ok": True}


@router.post("/change-staff")
def change_staff_auth(
    body: ChangeAuthRequest,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    username = body.username.strip()
    password = body.password.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")

    settings = get_or_create_settings(db)

    settings.staff_username = username
    settings.staff_password = hash_password(password)
    db.commit()
    return {"ok": True}
