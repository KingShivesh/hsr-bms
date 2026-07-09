from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db

router = APIRouter()

DEFAULT_ROLES = [
    {"role": "Owner", "can_reset": True, "can_settings": True, "can_reports": True},
    {"role": "Manager", "can_reset": True, "can_settings": False, "can_reports": True},
    {"role": "Cashier", "can_reset": False, "can_settings": False, "can_reports": False},
    {"role": "Waiter", "can_reset": False, "can_settings": False, "can_reports": False},
]


class StaffRoleBody(BaseModel):
    roles: list[dict]


def _ensure_defaults(db: Session) -> None:
    existing = {r.role for r in db.query(models.StaffRoleSetting).all()}
    for role in DEFAULT_ROLES:
        if role["role"] not in existing:
            db.add(models.StaffRoleSetting(**role))
    db.commit()


def _format(role: models.StaffRoleSetting) -> dict:
    return {
        "role": role.role,
        "can_reset": role.can_reset,
        "can_settings": role.can_settings,
        "can_reports": role.can_reports,
    }


@router.get("/roles")
def get_roles(db: Session = Depends(get_db)):
    _ensure_defaults(db)
    rows = db.query(models.StaffRoleSetting).order_by(models.StaffRoleSetting.id.asc()).all()
    return [_format(r) for r in rows]


@router.post("/roles")
def save_roles(body: StaffRoleBody, db: Session = Depends(get_db)):
    _ensure_defaults(db)
    by_name = {r.role: r for r in db.query(models.StaffRoleSetting).all()}
    for data in body.roles:
        role_name = str(data.get("role", "")).strip()
        if not role_name:
            continue
        row = by_name.get(role_name)
        if not row:
            row = models.StaffRoleSetting(role=role_name)
            db.add(row)
        row.can_reset = bool(data.get("can_reset"))
        row.can_settings = bool(data.get("can_settings"))
        row.can_reports = bool(data.get("can_reports"))
    db.commit()
    return {"ok": True}
