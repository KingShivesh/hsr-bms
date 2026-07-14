from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from deps import create_token, get_current_claims, hash_password, require_admin, upgrade_password_if_plain, verify_password
import models

router = APIRouter()


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


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    settings = db.query(models.Settings).first()
    if not settings:
        raise HTTPException(status_code=500, detail="Settings not found, run seed.py")
    if body.username == settings.username and verify_password(body.password, settings.password):
        upgrade_password_if_plain(db, settings, body.password)
        return {
            "token": create_token(body.username, "admin"),
            "role": "admin",
            "username": body.username,
        }

    staff_username = getattr(settings, "staff_username", "staff") or "staff"
    staff_password = getattr(settings, "staff_password", "staff123") or "staff123"
    if body.username == staff_username and verify_password(body.password, staff_password):
        upgrade_staff_password_if_plain(db, settings, body.password)
        return {
            "token": create_token(body.username, "staff"),
            "role": "staff",
            "username": body.username,
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
