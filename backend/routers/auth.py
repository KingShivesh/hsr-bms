from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from deps import create_token, get_current_user, hash_password, upgrade_password_if_plain, verify_password
import models

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangeAuthRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    settings = db.query(models.Settings).first()
    if not settings:
        raise HTTPException(status_code=500, detail="Settings not found, run seed.py")
    if body.username != settings.username or not verify_password(body.password, settings.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    upgrade_password_if_plain(db, settings, body.password)
    return {"token": create_token(body.username)}


@router.post("/change")
def change_auth(
    body: ChangeAuthRequest,
    db: Session = Depends(get_db),
    _: str = Depends(get_current_user),
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
