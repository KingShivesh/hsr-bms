import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database import get_db
from deps import create_token, get_current_claims, hash_password, require_admin, upgrade_password_if_plain, verify_password
import models
from hsr_config import is_production_env

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

    @field_validator("username")
    @classmethod
    def validate_username(cls, value):
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Username must be at least 3 characters")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value):
        if is_production_env() and value in {"admin123", DEFAULT_STAFF_PASSWORD}:
            raise ValueError("Choose a non-default password for production")
        if len(value.strip()) < 8:
            raise ValueError("Password must contain at least 8 non-padding characters")
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must not exceed 72 UTF-8 bytes")
        return value


def login_key(request: Request, username: str) -> str:
    # Account-wide limits cannot be bypassed by rotating or spoofing client IPs.
    return username.strip().lower()


def assert_login_allowed(request: Request, username: str) -> str:
    key = login_key(request, username)
    now = time.time()
    for expired_key in list(_login_failures):
        if not any(now - ts < LOGIN_WINDOW_SECONDS for ts in _login_failures[expired_key]):
            _login_failures.pop(expired_key, None)
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
    if is_production_env() and password in {"admin123", DEFAULT_STAFF_PASSWORD}:
        record_login_failure(attempt_key)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    if username == settings.username and verify_password(password, settings.password):
        upgrade_password_if_plain(db, settings, password)
        clear_login_failures(attempt_key)
        return {
            "token": create_token(username, "admin", auth_version=settings.auth_version),
            "role": "admin",
            "username": username,
        }

    staff_username, staff_password = ensure_staff_credentials(db, settings)
    if username == staff_username and verify_password(password, staff_password):
        upgrade_staff_password_if_plain(db, settings, password)
        clear_login_failures(attempt_key)
        return {
            "token": create_token(username, "staff", auth_version=settings.staff_auth_version),
            "role": "staff",
            "username": username,
        }

    record_login_failure(attempt_key)
    raise HTTPException(status_code=401, detail="Invalid username or password")


@router.get("/me")
def me(claims: dict = Depends(get_current_claims)):
    return {key: claims[key] for key in ("username", "role", "expires_at")}


@router.post("/logout")
def logout(claims: dict = Depends(get_current_claims), db: Session = Depends(get_db)):
    db.query(models.RevokedToken).filter(models.RevokedToken.expires_at <= time.time()).delete()
    db.merge(models.RevokedToken(token_digest=claims["token_digest"], expires_at=claims["expires_at"]))
    db.commit()
    return {"ok": True}


@router.post("/change")
def change_auth(
    body: ChangeAuthRequest,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    username = body.username.strip()
    password = body.password
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")

    settings = db.query(models.Settings).with_for_update().populate_existing().first()

    settings.username = username
    settings.password = hash_password(password)
    settings.auth_version += 1
    db.commit()
    return {"ok": True}


@router.post("/change-staff")
def change_staff_auth(
    body: ChangeAuthRequest,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    username = body.username.strip()
    password = body.password
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")

    settings = db.query(models.Settings).with_for_update().populate_existing().first()

    settings.staff_username = username
    settings.staff_password = hash_password(password)
    settings.staff_auth_version += 1
    db.commit()
    return {"ok": True}
