from datetime import datetime, timedelta
import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
import json
from pricing import snapshot_tariff
from database import get_db, get_mutation_db
from hsr_config import IST_TZ, TABLE_RATES, get_ist_now, rate_for_table
from validators import require_full_name
from realtime import queue_realtime_event

router = APIRouter()


class BookingBody(BaseModel):
    customer_name: str
    phone: str = ""
    table_id: str = "ANY"
    table_type: str = "ANY"
    booking_time: str
    duration_mins: int = 60
    notes: str = ""
    member_id: str | None = None


def eligible_booking(booking, table_id):
    if booking.status != "booked" or booking.session_key:
        return False
    if (booking.table_id or "ANY").lower() not in ("any", table_id):
        return False
    expected_type = "POOL" if table_id == "t5" else "SNOOKER"
    if (booking.table_type or "ANY").upper() not in ("ANY", expected_type):
        return False
    return abs((_parse_time(booking.booking_time) - get_ist_now()).total_seconds()) <= 30 * 60


def booking_prices(db, tariff_mode="hourly", package_id=""):
    settings = db.query(models.Settings).first()
    return {table: {"rate": rate_for_table(table, 0, settings), "tariff": snapshot_tariff(settings, table, tariff_mode, package_id)} for table in TABLE_RATES}


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
        "member_id": b.member_id,
        "session_key": b.session_key,
        "has_saved_price": bool(b.pricing_json),
    }


def _booking_has_started(db: Session, booking: models.Booking) -> bool:
    return bool(booking.session_key or db.query(models.ActiveSession).filter(models.ActiveSession.booking_id == booking.id).first())


@router.get("/start-options/{table_id}")
def start_options(table_id: str, db: Session = Depends(get_db)):
    table_id = table_id.lower()
    if table_id not in TABLE_RATES:
        raise HTTPException(404, "Unknown table")
    rows = db.query(models.Booking).filter(models.Booking.status == "booked").order_by(models.Booking.booking_time).all()
    return [{**_format_booking(row), "start_price": json.loads(row.pricing_json).get(table_id) if row.pricing_json else None} for row in rows if eligible_booking(row, table_id)]


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
def list_bookings(db: Session = Depends(get_mutation_db)):
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
def create_booking(
    body: BookingBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_mutation_db),
):
    name = require_full_name(body.customer_name, "Booking customer name")
    if body.member_id:
        member = db.query(models.Member).filter(models.Member.customer_id == body.member_id).first()
        if not member:
            raise HTTPException(404, "Member not found")
        name = member.name
    booking_dt = _parse_time(body.booking_time)
    if booking_dt < get_ist_now() - timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Booking time cannot be in the past")

    duration = max(30, min(int(body.duration_mins or 60), 480))
    table_id = (body.table_id or "ANY").upper()
    table_type = (body.table_type or "ANY").upper()
    if table_id != "ANY" and table_id.lower() not in TABLE_RATES:
        raise HTTPException(status_code=400, detail="Unknown table.")
    if table_type not in {"ANY", "POOL", "SNOOKER"}:
        raise HTTPException(status_code=400, detail="Invalid table type.")
    start = booking_dt
    end = start + timedelta(minutes=duration)

    existing = (
        db.query(models.Booking)
        .filter(models.Booking.status == "booked")
        .with_for_update()
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
        member_id=body.member_id,
        pricing_json=json.dumps(booking_prices(db)),
    )
    db.add(booking)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Booking could not be created. Please retry.")
    db.refresh(booking)
    queue_realtime_event(background_tasks, "reservation.changed", "reservations", "bookings")
    queue_realtime_event(background_tasks, "table.updated", "floor", "live-floor")
    return _format_booking(booking)


@router.post("/{booking_id}/restore")
def restore_booking(
    booking_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_mutation_db),
):
    booking = db.query(models.Booking).filter(models.Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.session_key:
        raise HTTPException(409, "A started booking cannot be restored")
    if booking.status != "cancelled":
        return _format_booking(booking)

    booking_dt = _parse_time(booking.booking_time)
    if booking_dt < get_ist_now() - timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Booking time cannot be restored in the past")

    table_id = (booking.table_id or "ANY").upper()
    start = booking_dt
    end = start + timedelta(minutes=booking.duration_mins or 60)
    existing = (
        db.query(models.Booking)
        .filter(models.Booking.status == "booked", models.Booking.id != booking.id)
        .with_for_update()
        .all()
    )
    for b in existing:
        if table_id == "ANY" or b.table_id == "ANY" or b.table_id.upper() != table_id:
            continue
        b_start = _parse_time(b.booking_time)
        b_end = b_start + timedelta(minutes=b.duration_mins)
        if start < b_end and end > b_start:
            raise HTTPException(status_code=400, detail=f"Booking conflict on {table_id}")

    booking.status = "booked"
    booking.released_at = ""
    db.commit()
    db.refresh(booking)
    queue_realtime_event(background_tasks, "reservation.changed", "reservations", "bookings")
    queue_realtime_event(background_tasks, "table.updated", "floor", "live-floor")
    return _format_booking(booking)


@router.delete("/{booking_id}")
def cancel_booking(
    booking_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_mutation_db),
):
    booking = db.query(models.Booking).filter(models.Booking.id == booking_id).first()
    if booking:
        if booking.session_key:
            raise HTTPException(409, "A started booking cannot be cancelled")
        booking.status = "cancelled"
        db.commit()
        queue_realtime_event(background_tasks, "reservation.changed", "reservations", "bookings")
        queue_realtime_event(background_tasks, "table.updated", "floor", "live-floor")
    return {"ok": True}
