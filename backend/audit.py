import time

from fastapi import HTTPException
from sqlalchemy.orm import Session

from deps import verify_password
from hsr_config import format_ist_now
import models


def get_controls(db: Session) -> models.SecurityControl:
    controls = db.query(models.SecurityControl).first()
    if controls:
        return controls
    controls = models.SecurityControl(
        manager_pin_hash="",
        require_pin_for_resets=False,
        alert_unbilled_minutes=10,
    )
    db.add(controls)
    db.commit()
    db.refresh(controls)
    return controls


def require_manager_pin(db: Session, pin: str | None) -> None:
    controls = get_controls(db)
    if not controls.require_pin_for_resets:
        return
    if not controls.manager_pin_hash:
        raise HTTPException(status_code=400, detail="Manager PIN is not configured")
    if not pin or not verify_password(pin, controls.manager_pin_hash):
        raise HTTPException(status_code=403, detail="Manager PIN required")


def log_action(
    db: Session,
    action: str,
    detail: str = "",
    *,
    severity: str = "info",
    amount: int = 0,
    staff: str = "admin",
) -> None:
    db.add(models.AuditLog(
        date=format_ist_now(),
        ts=time.time() * 1000,
        action=action,
        severity=severity,
        staff=staff,
        detail=detail,
        amount=amount,
    ))
