import os
import hashlib
import time
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

import models
from database import SessionLocal
from hsr_config import DEFAULT_SECRET_KEY

SECRET_KEY = os.getenv("SECRET_KEY", DEFAULT_SECRET_KEY)
ALGORITHM = "HS256"
TOKEN_HOURS = 24

security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, stored: str) -> bool:
    if not stored:
        return False
    if stored.startswith("$2b$") or stored.startswith("$2a$"):
        try:
            return bcrypt.checkpw(plain.encode(), stored.encode())
        except ValueError:
            return False
    return plain == stored


def upgrade_password_if_plain(db: Session, settings: models.Settings, plain: str) -> None:
    if not (settings.password.startswith("$2b$") or settings.password.startswith("$2a$")):
        settings.password = hash_password(plain)
        db.commit()


def create_token(username: str, role: str = "admin", *, auth_version: int | None = None) -> str:
    if auth_version is None:
        with SessionLocal() as db:
            settings = db.query(models.Settings).first()
            field = "staff_auth_version" if role == "staff" else "auth_version"
            auth_version = getattr(settings, field, 0) if settings else 0
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    return jwt.encode(
        {"sub": username, "role": role, "exp": expire, "version": auth_version, "jti": uuid.uuid4().hex},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def get_current_claims(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM], options={"require_exp": True})
        username = payload.get("sub")
        role = payload.get("role") or "admin"
        if "version" not in payload or not payload.get("jti"):
            raise HTTPException(status_code=401, detail="Session upgraded. Please log in again.")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
        if role not in {"admin", "staff"}:
            raise HTTPException(status_code=401, detail="Invalid token role")
        claims = {
            "username": username,
            "role": role,
            "expires_at": payload.get("exp"),
            "auth_version": payload.get("version", 0),
            "token_digest": hashlib.sha256(credentials.credentials.encode()).hexdigest(),
        }
        with SessionLocal() as db:
            assert_claims_active(db, claims)
        return claims
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def assert_claims_active(db: Session, claims: dict) -> None:
    settings = db.query(models.Settings).populate_existing().first()
    staff = claims["role"] == "staff"
    name = settings.staff_username if settings and staff else (settings.username if settings else None)
    version = getattr(settings, "staff_auth_version" if staff else "auth_version", 0)
    revoked = db.get(models.RevokedToken, claims["token_digest"])
    if (not settings or name != claims["username"] or version != claims["auth_version"]
            or revoked is not None or float(claims.get("expires_at") or 0) <= time.time()):
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")


def get_current_user(claims: dict = Depends(get_current_claims)) -> str:
    return claims["username"]


def get_current_role(claims: dict = Depends(get_current_claims)) -> str:
    return claims["role"]


def require_admin(claims: dict = Depends(get_current_claims)) -> dict:
    if claims["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return claims
