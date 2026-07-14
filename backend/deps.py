import os
from datetime import datetime, timedelta

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

import models

SECRET_KEY = os.getenv("SECRET_KEY", "billiards-secret-key-change-in-production")
ALGORITHM = "HS256"
TOKEN_HOURS = 24

security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, stored: str) -> bool:
    if stored.startswith("$2b$") or stored.startswith("$2a$"):
        return bcrypt.checkpw(plain.encode(), stored.encode())
    return plain == stored


def upgrade_password_if_plain(db: Session, settings: models.Settings, plain: str) -> None:
    if not (settings.password.startswith("$2b$") or settings.password.startswith("$2a$")):
        settings.password = hash_password(plain)
        db.commit()


def create_token(username: str, role: str = "admin") -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_HOURS)
    return jwt.encode(
        {"sub": username, "role": role, "exp": expire},
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
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
        return {
            "username": username,
            "role": payload.get("role") or "admin",
        }
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(claims: dict = Depends(get_current_claims)) -> str:
    return claims["username"]


def get_current_role(claims: dict = Depends(get_current_claims)) -> str:
    return claims["role"]


def require_admin(claims: dict = Depends(get_current_claims)) -> dict:
    if claims["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return claims
