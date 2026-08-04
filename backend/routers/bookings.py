from datetime import datetime, timedelta
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from database import get_db
from hsr_config import IST_TZ, get_ist_now
from validators import require_full_name

router = APIRouter()


class BookingBody(BaseModel):
    customer_name: str
    phone: str = ""
    table_id: str = "ANY"
    table_type: str = "ANY"
    booking_time: str
    duration_mins: int = 60
    notes: str = ""


def _parse_time(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="Booking time must be a valid date/time")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(IST_TZ).replace(tzinfo=None)
    return parsed


def _format_booking(b: models.Booking) -> dict:
    return {
        "id": b.id,
        "customer_name": b.customer_name,
        "phone": b.phone or "",
        "table_id": b.table_id or "ANY",
        "table_type": b.table_type or "ANY",
        "booking_time": b.booking_time,
        "duration_mins": b.duration_mins,
        "notes": b.notes or "",
        "status": b.status,
        "created_at": b.created_at,
        "released_at": b.released_at or "",
    }


def _booking_has_started(db: Session, booking: models.Booking) -> bool:
    if booking.table_id and booking.table_id != "ANY":
        active = db.query(models.ActiveSession).filter(
            func.lower(models.ActiveSession.table_id) == booking.table_id.lower(),
            models.ActiveSession.customer_name.ilike(booking.customer_name),
        ).first()
        if active:
            return True
    return bool(db.query(models.ActiveSession).filter(
        models.ActiveSession.customer_name.ilike(booking.customer_name)
    ).first())


def _release_missed_bookings(db: Session) -> None:
    settings = db.query(models.Settings).first()
    grace = max(1, int(getattr(settings, "booking_grace_minutes", 10) or 10))
    now = get_ist_now()
    changed = False
    rows = db.query(models.Booking).filter(models.Booking.status == "booked").all()
    for booking in rows:
        booking_dt = _parse_time(booking.booking_time)
        if now <= booking_dt + timedelta(minutes=grace):
            continue
        if _booking_has_started(db, booking):
            booking.status = "completed"
        else:
            booking.status = "missed"
            booking.released_at = now.strftime("%d/%m/%Y, %H:%M")
        changed = True
    if changed:
        db.commit()


@router.get("")
def list_bookings(db: Session = Depends(get_db)):
    _release_missed_bookings(db)
    now = get_ist_now() - timedelta(hours=2)
    rows = (
        db.query(models.Booking)
        .filter(models.Booking.status.in_(["booked", "missed"]))
        .order_by(models.Booking.booking_time.asc())
        .all()
    )
    return [
        _format_booking(b)
        for b in rows
        if b.status == "missed" or _parse_time(b.booking_time) >= now
    ]


@router.post("")
def create_booking(body: BookingBody, db: Session = Depends(get_db)):
    name = require_full_name(body.customer_name, "Booking customer name")
    booking_dt = _parse_time(body.booking_time)
    if booking_dt < get_ist_now() - timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Booking time cannot be in the past")

    duration = max(30, min(int(body.duration_mins or 60), 480))
    table_id = (body.table_id or "ANY").upper()
    table_type = (body.table_type or "ANY").upper()
    start = booking_dt
    end = start + timedelta(minutes=duration)

    existing = (
        db.query(models.Booking)
        .filter(models.Booking.status == "booked")
        .all()
    )
    for b in existing:
        if table_id == "ANY" or b.table_id == "ANY" or b.table_id.upper() != table_id:
            continue
        b_start = _parse_time(b.booking_time)
        b_end = b_start + timedelta(minutes=b.duration_mins)
        if start < b_end and end > b_start:
            raise HTTPException(status_code=400, detail=f"Booking conflict on {table_id}")

    booking = models.Booking(
        customer_name=name,
        phone=body.phone.strip(),
        table_id=table_id,
        table_type=table_type,
        booking_time=start.isoformat(timespec="minutes"),
        duration_mins=duration,
        notes=body.notes.strip(),
        status="booked",
        created_at=get_ist_now().strftime("%d/%m/%Y, %H:%M"),
        ts=time.time() * 1000,
    )
    db.add(booking)
    db.commit()
    db.refresh(booking)
    return _format_booking(booking)


@router.delete("/{booking_id}")
def cancel_booking(booking_id: int, db: Session = Depends(get_db)):
    booking = db.query(models.Booking).filter(models.Booking.id == booking_id).first()
    if booking:
        booking.status = "cancelled"
        db.commit()
    return {"ok": True}
