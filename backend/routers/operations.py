from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from database import get_db
from typing import Optional
import models
from audit import get_controls, log_action
from deps import hash_password, require_admin
from pricing import get_peak_multiplier

router = APIRouter()

# ─────────────────────────────────────────
# Peak Hour Rates
# ─────────────────────────────────────────

class PeakHourBody(BaseModel):
    start_hour:  int = Field(ge=0, le=23)
    end_hour:    int = Field(ge=1, le=24)
    multiplier:  float = Field(default=1.5, gt=0, le=5)
    label:       str   = Field(default="Peak Hours", max_length=60)


def get_or_create_settings(db: Session) -> models.Settings:
    settings = db.query(models.Settings).first()
    if settings:
        return settings
    settings = models.Settings()
    db.add(settings)
    db.flush()
    return settings

@router.get("/peak-hours")
def get_peak_hours(db: Session = Depends(get_db)):
    rows = db.query(models.PeakHourRate).all()
    return [
        { "id": r.id, "start_hour": r.start_hour, "end_hour": r.end_hour,
          "multiplier": r.multiplier, "label": r.label }
        for r in rows
    ]

@router.post("/peak-hours")
def add_peak_hour(
    body: PeakHourBody,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    if not (0 <= body.start_hour < body.end_hour <= 24):
        raise HTTPException(status_code=400, detail="Peak hours must be between 0 and 24, with start before end")
    if body.multiplier <= 0 or body.multiplier > 5:
        raise HTTPException(status_code=400, detail="Peak multiplier must be between 0 and 5")
    db.add(models.PeakHourRate(
        start_hour=body.start_hour, end_hour=body.end_hour,
        multiplier=body.multiplier, label=body.label.strip() or "Peak Hours"
    ))
    db.commit()
    return {"ok": True}

@router.put("/peak-hours/{rule_id}")
def update_peak_hour(
    rule_id: int,
    body: PeakHourBody,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    if not (0 <= body.start_hour < body.end_hour <= 24):
        raise HTTPException(status_code=400, detail="Peak hours must be between 0 and 24, with start before end")
    if body.multiplier <= 0 or body.multiplier > 5:
        raise HTTPException(status_code=400, detail="Peak multiplier must be between 0 and 5")
    rule = db.query(models.PeakHourRate).filter(models.PeakHourRate.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    rule.start_hour = body.start_hour
    rule.end_hour = body.end_hour
    rule.multiplier = body.multiplier
    rule.label = body.label.strip() or "Peak Hours"
    db.commit()
    return {"ok": True}

@router.delete("/peak-hours/{rule_id}")
def delete_peak_hour(
    rule_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    rule = db.query(models.PeakHourRate).filter(models.PeakHourRate.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()
    return {"ok": True}

@router.get("/current-rate")
def get_current_rate(db: Session = Depends(get_db)):
    """Returns current multiplier based on time of day."""
    multiplier, label = get_peak_multiplier(db)
    return {
        "multiplier": multiplier,
        "label":      label,
        "is_peak":    multiplier > 1.0,
    }

# ─────────────────────────────────────────
# GST Settings
# ─────────────────────────────────────────

class GSTBody(BaseModel):
    gst_percent: float = Field(ge=0, le=28)

class SecurityControlsBody(BaseModel):
    manager_pin: Optional[str] = Field(default=None, max_length=32)
    require_pin_for_resets: bool = False
    alert_unbilled_minutes: int = Field(default=10, ge=1, le=720)

@router.get("/gst")
def get_gst(db: Session = Depends(get_db)):
    s = get_or_create_settings(db)
    return {"gst_percent": s.gst_percent if s and s.gst_percent else 0}

@router.post("/gst")
def save_gst(
    body: GSTBody,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    s = get_or_create_settings(db)
    s.gst_percent = body.gst_percent
    db.commit()
    return {"ok": True}

# ─────────────────────────────────────────
# Anti-leakage controls & audit log
# ─────────────────────────────────────────

@router.get("/security-controls")
def get_security_controls(
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    c = get_controls(db)
    return {
        "has_manager_pin": bool(c.manager_pin_hash),
        "require_pin_for_resets": c.require_pin_for_resets,
        "alert_unbilled_minutes": c.alert_unbilled_minutes,
    }

@router.post("/security-controls")
def save_security_controls(
    body: SecurityControlsBody,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    c = get_controls(db)
    if body.manager_pin:
        if len(body.manager_pin) < 4:
            raise HTTPException(status_code=400, detail="Manager PIN must be at least 4 digits")
        c.manager_pin_hash = hash_password(body.manager_pin)
    c.require_pin_for_resets = body.require_pin_for_resets
    c.alert_unbilled_minutes = body.alert_unbilled_minutes
    log_action(
        db,
        "security_controls_updated",
        "Anti-leakage control settings were updated",
        severity="warning",
    )
    db.commit()
    return {"ok": True}

@router.get("/audit-logs")
def get_audit_logs(
    limit: int = 50,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    safe_limit = max(1, min(limit, 200))
    rows = db.query(models.AuditLog).order_by(models.AuditLog.ts.desc()).limit(safe_limit).all()
    return [
        {
            "id": r.id,
            "date": r.date,
            "ts": r.ts,
            "action": r.action,
            "severity": r.severity,
            "staff": r.staff,
            "detail": r.detail,
            "amount": r.amount,
        }
        for r in rows
    ]
