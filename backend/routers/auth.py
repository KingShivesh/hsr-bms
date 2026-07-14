from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from deps import create_token, get_current_claims, hash_password, require_admin, upgrade_password_if_plain, verify_password
import models

router = APIRouter()
DEFAULT_STAFF_USERNAME = "staff"
DEFAULT_STAFF_PASSWORD = "staff123"


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangeAuthRequest(BaseModel):
    username: str
    password: str


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
def login(body: LoginRequest, db: Session = Depends(get_db)):
    settings = db.query(models.Settings).first()
    if not settings:
        raise HTTPException(status_code=500, detail="Settings not found, run seed.py")
    username = body.username.strip()
    password = body.password.strip()

    if username == settings.username and verify_password(password, settings.password):
        upgrade_password_if_plain(db, settings, password)
        return {
            "token": create_token(username, "admin"),
            "role": "admin",
            "username": username,
        }

    staff_username, staff_password = ensure_staff_credentials(db, settings)
    if username == staff_username and verify_password(password, staff_password):
        upgrade_staff_password_if_plain(db, settings, password)
        return {
            "token": create_token(username, "staff"),
            "role": "staff",
            "username": username,
        }

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
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    settings = db.query(models.Settings).first()
    if not settings:
        raise HTTPException(status_code=500, detail="Settings not found")

    settings.username = body.username
    settings.password = hash_password(body.password)
    db.commit()
    return {"ok": True}


@router.post("/change-staff")
def change_staff_auth(
    body: ChangeAuthRequest,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    settings = db.query(models.Settings).first()
    if not settings:
        raise HTTPException(status_code=500, detail="Settings not found")

    settings.staff_username = body.username
    settings.staff_password = hash_password(body.password)
    db.commit()
    return {"ok": True}
