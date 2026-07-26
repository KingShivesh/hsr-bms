import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from hsr_config import TABLES, get_ist_now
from validators import require_full_name

router = APIRouter()


class WaitlistBody(BaseModel):
    customer_name: str
    phone: str = ""
    party_size: int = 1
    preferred_type: str = "ANY"
    notes: str = ""


class SeatBody(BaseModel):
    table_id: str


def _available_tables(db: Session, preferred_type: str = "ANY") -> list[dict]:
    active_ids = {
        (s.table_id or "").lower()
        for s in db.query(models.ActiveSession).filter(
            models.ActiveSession.customer_name != ""
        ).all()
    }
    maintenance_ids = {(m.table_id or "").lower() for m in db.query(models.TableMaintenance).all()}
    pref = (preferred_type or "ANY").upper()
    tables = [
        t
        for t in TABLES
        if t["id"] not in active_ids
        and t["id"] not in maintenance_ids
        and (pref == "ANY" or t["type"] == pref)
    ]
    return tables


def _format_entry(entry: models.WaitlistEntry, db: Session, position: int) -> dict:
    available = _available_tables(db, entry.preferred_type)
    recommended = available[0] if available else None
    wait_mins = max(0, round((time.time() * 1000 - entry.ts) / 1000 / 60))
    return {
        "id": entry.id,
        "customer_name": entry.customer_name,
        "phone": entry.phone or "",
        "party_size": entry.party_size,
        "preferred_type": entry.preferred_type or "ANY",
        "notes": entry.notes or "",
        "status": entry.status,
        "created_at": entry.created_at,
        "wait_mins": wait_mins,
        "position": position,
        "recommended_table": recommended,
        "seated_table": entry.seated_table or "",
    }


@router.get("")
def list_waitlist(db: Session = Depends(get_db)):
    rows = (
        db.query(models.WaitlistEntry)
        .filter(models.WaitlistEntry.status == "waiting")
        .order_by(models.WaitlistEntry.ts.asc())
        .all()
    )
    return [_format_entry(row, db, i + 1) for i, row in enumerate(rows)]


@router.post("")
def add_waitlist_entry(body: WaitlistBody, db: Session = Depends(get_db)):
    name = require_full_name(body.customer_name, "Queue customer name")
    preferred_type = (body.preferred_type or "ANY").upper()
    if preferred_type not in ["ANY", "POOL", "SNOOKER"]:
        raise HTTPException(status_code=400, detail="Invalid preferred table type")

    entry = models.WaitlistEntry(
        customer_name=name,
        phone=body.phone.strip(),
        party_size=max(1, int(body.party_size or 1)),
        preferred_type=preferred_type,
        notes=body.notes.strip(),
        status="waiting",
        created_at=get_ist_now().strftime("%d/%m/%Y, %H:%M"),
        ts=time.time() * 1000,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _format_entry(entry, db, 1)


@router.post("/{entry_id}/seat")
def seat_waitlist_entry(entry_id: int, body: SeatBody, db: Session = Depends(get_db)):
    entry = db.query(models.WaitlistEntry).filter(models.WaitlistEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Waitlist entry not found")
    entry.status = "seated"
    entry.seated_table = (body.table_id or "").lower()
    db.commit()
    return {"ok": True}


@router.delete("/{entry_id}")
def cancel_waitlist_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.WaitlistEntry).filter(models.WaitlistEntry.id == entry_id).first()
    if entry:
        entry.status = "cancelled"
        db.commit()
    return {"ok": True}
