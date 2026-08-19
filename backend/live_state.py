from __future__ import annotations

import json
import math
import time
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import models
from audit import get_controls
from hsr_config import TABLES, TABLE_RATES, get_ist_now, get_ist_today_str, rate_for_table
from pricing import calc_checkout


TABLE_STATUS = {
    "available": {"key": "available", "label": "Available", "tone": "idle"},
    "running": {"key": "running", "label": "Running", "tone": "running"},
    "paused": {"key": "paused", "label": "Paused", "tone": "paused"},
    "reserved": {"key": "reserved", "label": "Reserved", "tone": "booked"},
    "maintenance": {"key": "maintenance", "label": "Maintenance", "tone": "maintenance"},
}


def normalize_table_id(table_id: str) -> str:
    return (table_id or "").strip().lower()


def safe_json(raw: str | None, fallback):
    try:
        parsed = json.loads(raw or "")
    except (TypeError, json.JSONDecodeError):
        return fallback
    return parsed if parsed is not None else fallback


def valid_duration(duration: int | None) -> bool:
    return isinstance(duration, int) and 0 < duration <= 12 * 60


def valid_transaction(t: models.Transaction) -> bool:
    if not valid_duration(t.duration):
        return False
    return bool((t.customer_name or "").strip() or (t.total or 0) > 0)


def today_transactions(db: Session, day: str | None = None) -> list[models.Transaction]:
    day = day or get_ist_today_str()
    return [
        txn
        for txn in db.query(models.Transaction)
        .filter(models.Transaction.date.like(f"{day}%"))
        .all()
        if valid_transaction(txn)
    ]


def dated_transactions(db: Session, day: datetime) -> list[models.Transaction]:
    return today_transactions(db, day.strftime("%d/%m/%Y"))


def recent_transactions(db: Session, days: int) -> list[models.Transaction]:
    since_ms = (time.time() - days * 24 * 60 * 60) * 1000
    return [
        txn
        for txn in db.query(models.Transaction)
        .filter(models.Transaction.ts >= since_ms)
        .all()
        if valid_transaction(txn)
    ]


def food_only_for_day(db: Session, day: str | None = None) -> list[models.FoodOnlyOrder]:
    day = day or get_ist_today_str()
    return db.query(models.FoodOnlyOrder).filter(models.FoodOnlyOrder.date.like(f"{day}%")).all()


def food_only_recent(db: Session, days: int) -> list[models.FoodOnlyOrder]:
    since_ms = (time.time() - days * 24 * 60 * 60) * 1000
    return db.query(models.FoodOnlyOrder).filter(models.FoodOnlyOrder.ts >= since_ms).all()


def food_only_all(db: Session) -> list[models.FoodOnlyOrder]:
    return db.query(models.FoodOnlyOrder).all()


def summarize_day(transactions: list[models.Transaction], food_orders: list[models.FoodOnlyOrder] | None = None) -> dict:
    food_orders = food_orders or []
    table_revenue = sum(txn.total or 0 for txn in transactions)
    session_food = sum(txn.food_charge or 0 for txn in transactions)
    counter_food = sum(order.total or 0 for order in food_orders)
    total_food = session_food + counter_food
    total_revenue = table_revenue + counter_food
    sessions = len(transactions)
    return {
        "sale": table_revenue,
        "total_revenue": total_revenue,
        "food": total_food,
        "sessions": sessions,
        "cust": sessions,
        "food_attach": round((total_food / total_revenue) * 100) if total_revenue else 0,
        "avg_bill": round(total_revenue / sessions) if sessions else 0,
        "avg_time": round(sum(txn.duration or 0 for txn in transactions) / sessions) if sessions else 0,
        "tables_used": len({normalize_table_id(txn.table_id) for txn in transactions if txn.table_id}),
    }


def status_for_table(*, session=None, booking=None, maintenance=None) -> dict:
    if maintenance:
        return TABLE_STATUS["maintenance"]
    paused = session.get("paused") if isinstance(session, dict) else getattr(session, "paused", False)
    if session and paused:
        return TABLE_STATUS["paused"]
    if session:
        return TABLE_STATUS["running"]
    if booking:
        return TABLE_STATUS["reserved"]
    return TABLE_STATUS["available"]


def table_frames(db: Session, session: models.ActiveSession) -> list[models.SessionFrame]:
    session_key = getattr(session, "session_key", "") or ""
    query = db.query(models.SessionFrame).filter(
        func.lower(models.SessionFrame.table_id) == normalize_table_id(session.table_id)
    )
    if session_key:
        query = query.filter(
            or_(
                models.SessionFrame.session_key == session_key,
                (
                    (models.SessionFrame.session_key == "")
                    & (models.SessionFrame.session_started_at == session.start_time)
                ),
            )
        )
    else:
        query = query.filter(models.SessionFrame.session_started_at == session.start_time)
    return query.order_by(models.SessionFrame.frame_no.asc()).all()


def serialize_frame(frame: models.SessionFrame) -> dict:
    return {
        "id": frame.id,
        "table_id": normalize_table_id(frame.table_id),
        "frame_no": frame.frame_no,
        "started_at": frame.started_at,
        "ended_at": frame.ended_at,
        "loser_name": frame.loser_name or "",
        "status": frame.status or "open",
    }


def session_elapsed_ms(session: models.ActiveSession, now_ms: float | None = None) -> float:
    now_ms = now_ms or time.time() * 1000
    if session.paused:
        return max(0, float(session.elapsed_ms or 0))
    return max(0, now_ms - float(session.start_time or now_ms))


def billable_minutes(elapsed_ms: float, min_mins: int = 0) -> int:
    minutes = max(1, int(math.ceil(max(0, elapsed_ms) / 1000 / 60)))
    return max(minutes, int(min_mins or 0))


def live_charge(db: Session, session: models.ActiveSession, elapsed_ms: float, settings) -> dict:
    minutes = min(billable_minutes(elapsed_ms, getattr(settings, "min_session", 0) or 0), 12 * 60)
    checkout = calc_checkout(
        db,
        minutes=minutes,
        hourly_rate=session.rate or 0,
        food_total=session.food_total or 0,
    )
    return {
        "minutes": minutes,
        "play": checkout["play"],
        "food": checkout["food"],
        "total": checkout["total"],
        "peak_surcharge": checkout["peak_surcharge"],
        "gst_amt": checkout["gst_amt"],
    }


def serialize_session(db: Session, session: models.ActiveSession, *, now_ms: float | None = None, controls=None, settings=None) -> dict:
    now_ms = now_ms or time.time() * 1000
    controls = controls or get_controls(db)
    settings = settings or db.query(models.Settings).first()
    elapsed_ms = session_elapsed_ms(session, now_ms)
    frames = [serialize_frame(frame) for frame in table_frames(db, session)]
    players = safe_json(getattr(session, "players_json", "[]"), [])
    if not players:
        players = [session.customer_name] if session.customer_name else []
    charge = live_charge(db, session, elapsed_ms, settings)
    status = status_for_table(session=session)
    return {
        "table_id": normalize_table_id(session.table_id),
        "customer_name": session.customer_name,
        "rate": session.rate or 0,
        "start_time": session.start_time,
        "elapsed_ms": session.elapsed_ms or 0,
        "elapsed_ms_current": elapsed_ms,
        "elapsed_seconds": int(elapsed_ms / 1000),
        "paused": bool(session.paused),
        "food_total": session.food_total or 0,
        "food_items": safe_json(session.food_items, []),
        "reservation": safe_json(session.reservation, None) if session.reservation else None,
        "notes": session.notes or "",
        "split": bool(session.split),
        "split_name": session.split_name or "",
        "billing_mode": getattr(session, "billing_mode", "single") or "single",
        "players": players,
        "frames": frames,
        "current_frame": next((frame for frame in frames if frame["status"] == "open"), None),
        "leakage_alert": (
            controls.alert_unbilled_minutes > 0
            and not session.paused
            and session.start_time
            and (elapsed_ms / 1000 / 60) >= controls.alert_unbilled_minutes
        ),
        "running_total": charge["total"],
        "play_estimate": charge["play"],
        "status_key": status["key"],
        "status_label": status["label"],
        "status_tone": status["tone"],
    }


def serialize_booking(booking: models.Booking | None) -> dict | None:
    if not booking:
        return None
    return {
        "id": booking.id,
        "customer_name": booking.customer_name,
        "phone": booking.phone or "",
        "table_id": booking.table_id or "ANY",
        "table_type": booking.table_type or "ANY",
        "booking_time": booking.booking_time,
        "duration_mins": booking.duration_mins,
        "notes": booking.notes or "",
        "status": booking.status,
        "created_at": booking.created_at,
        "released_at": booking.released_at or "",
    }


def next_bookings_by_table(db: Session) -> dict[str, models.Booking]:
    now = get_ist_now() - timedelta(hours=2)
    result = {}
    rows = (
        db.query(models.Booking)
        .filter(models.Booking.status == "booked")
        .order_by(models.Booking.booking_time.asc())
        .all()
    )
    for booking in rows:
        table_id = normalize_table_id(booking.table_id)
        if not table_id or table_id == "any":
            continue
        try:
            booking_dt = datetime.fromisoformat(booking.booking_time)
        except (TypeError, ValueError):
            booking_dt = now
        if booking_dt < now:
            continue
        result.setdefault(table_id, booking)
    return result


def build_table_state(db: Session) -> dict:
    now_ms = time.time() * 1000
    controls = get_controls(db)
    settings = db.query(models.Settings).first()
    rates = {
        "wr": getattr(settings, "wr", TABLE_RATES["t1"]) if settings else TABLE_RATES["t1"],
        "sr": getattr(settings, "sr", TABLE_RATES["t3"]) if settings else TABLE_RATES["t3"],
        "pr": getattr(settings, "pr", TABLE_RATES["t5"]) if settings else TABLE_RATES["t5"],
    }
    sessions = [
        row for row in db.query(models.ActiveSession).all()
        if (row.customer_name or "").strip()
    ]
    sessions_by_table = {
        normalize_table_id(session.table_id): serialize_session(
            db,
            session,
            now_ms=now_ms,
            controls=controls,
            settings=settings,
        )
        for session in sessions
    }
    maintenance_by_table = {
        normalize_table_id(row.table_id): {"reason": row.reason, "since": row.since}
        for row in db.query(models.TableMaintenance).all()
    }
    bookings_by_table = next_bookings_by_table(db)
    table_rows = []
    for table in TABLES:
        table_id = table["id"]
        session = sessions_by_table.get(table_id)
        booking = bookings_by_table.get(table_id)
        maintenance = maintenance_by_table.get(table_id)
        status = status_for_table(session=session, booking=booking, maintenance=maintenance)
        table_rows.append({
            **table,
            "rate": rate_for_table(table_id, 0, settings),
            "status_key": status["key"],
            "status_label": status["label"],
            "status_tone": status["tone"],
            "session": session,
            "booking": serialize_booking(booking),
            "maintenance": maintenance,
            "running_total": session["running_total"] if session else 0,
            "elapsed_seconds": session["elapsed_seconds"] if session else 0,
        })
    return {
        "generated_at": now_ms,
        "tables": table_rows,
        "active_sessions": list(sessions_by_table.values()),
        "active_tables": len(sessions_by_table),
        "idle_tables": max(len(TABLES) - len(sessions_by_table), 0),
        "rates": rates,
        "maintenance": maintenance_by_table,
    }


def delta(current: int | float, previous: int | float, noun: str = "usual") -> dict:
    current = current or 0
    previous = previous or 0
    if previous <= 0 and current <= 0:
        return {"direction": "flat", "percent": 0, "label": f"same as {noun}"}
    if previous <= 0:
        return {"direction": "up", "percent": 100, "label": f"new vs {noun}"}
    percent = round(((current - previous) / previous) * 100)
    if percent == 0:
        return {"direction": "flat", "percent": 0, "label": f"same as {noun}"}
    return {
        "direction": "up" if percent > 0 else "down",
        "percent": percent,
        "label": f"{percent:+d}% vs {noun}",
    }


def dashboard_payload(db: Session, period: str = "today") -> dict:
    period = period if period in {"today", "week", "all"} else "today"
    table_state = build_table_state(db)
    today = get_ist_today_str()
    yesterday_dt = get_ist_now() - timedelta(days=1)
    today_txns = today_transactions(db, today)
    yesterday_txns = dated_transactions(db, yesterday_dt)
    today_food_orders = food_only_for_day(db, today)
    yesterday_food_orders = food_only_for_day(db, yesterday_dt.strftime("%d/%m/%Y"))
    today_summary = summarize_day(today_txns, today_food_orders)
    yesterday_summary = summarize_day(yesterday_txns, yesterday_food_orders)
    if period == "week":
        period_txns = recent_transactions(db, 7)
        period_food_orders = food_only_recent(db, 7)
        period_label = "Last 7 days"
    elif period == "all":
        period_txns = [
            txn for txn in db.query(models.Transaction).all()
            if valid_transaction(txn)
        ]
        period_food_orders = food_only_all(db)
        period_label = "All time"
    else:
        period_txns = today_txns
        period_food_orders = today_food_orders
        period_label = "Today"
    period_summary = summarize_day(period_txns, period_food_orders)
    recent = recent_transactions(db, 7)
    by_day = defaultdict(lambda: {"revenue": 0, "sessions": 0})
    for txn in recent:
        day_key = (txn.date or "")[:10]
        if not day_key or day_key == today:
            continue
        by_day[day_key]["revenue"] += txn.total or 0
        by_day[day_key]["sessions"] += 1
    avg_recent_revenue = round(sum(row["revenue"] for row in by_day.values()) / len(by_day)) if by_day else 0
    avg_recent_sessions = round(sum(row["sessions"] for row in by_day.values()) / len(by_day)) if by_day else 0
    live_floor_value = sum(table["running_total"] for table in table_state["tables"])
    active_tables = table_state["active_tables"]
    total_tables = len(TABLES)
    occupancy = round((active_tables / total_tables) * 100) if total_tables else 0

    missed_bookings = db.query(models.Booking).filter(models.Booking.status == "missed").count()
    waitlist_count = db.query(models.WaitlistEntry).filter(models.WaitlistEntry.status == "waiting").count()
    controls = get_controls(db)
    attention = []
    for table in table_state["tables"]:
        session = table.get("session")
        if not session:
            continue
        if session.get("current_frame"):
            attention.append({
                "type": "critical",
                "title": f"{table['id'].upper()} has a live frame",
                "detail": "End the frame before final checkout.",
                "page": "tables",
            })
        if session.get("leakage_alert"):
            attention.append({
                "type": "critical",
                "title": f"{table['id'].upper()} crossed {controls.alert_unbilled_minutes} min",
                "detail": "Review billing before the session gets stale.",
                "page": "tables",
            })
        elif session.get("paused"):
            attention.append({
                "type": "warning",
                "title": f"{table['id'].upper()} is paused",
                "detail": "Resume or close it before shift handover.",
                "page": "tables",
            })
    if missed_bookings:
        attention.append({
            "type": "warning",
            "title": f"{missed_bookings} missed booking{'s' if missed_bookings != 1 else ''}",
            "detail": "Review the reservation register.",
            "page": "reservations",
        })
    if waitlist_count:
        attention.append({
            "type": "info",
            "title": f"{waitlist_count} guest{'s' if waitlist_count != 1 else ''} waiting",
            "detail": "Seat the queue when a table opens.",
            "page": "waitlist",
        })

    metrics = {
        **period_summary,
        "active_tables": active_tables,
        "idle_tables": table_state["idle_tables"],
        "total_tables": total_tables,
        "occupancy": occupancy,
        "live_floor_value": live_floor_value,
        "top_table": "-",
        "recent_average": avg_recent_revenue,
    }
    if period_txns:
        table_counts = defaultdict(int)
        for txn in period_txns:
            table_counts[txn.table_id] += 1
        metrics["top_table"] = max(table_counts, key=table_counts.get)
    revenue_trend = delta(metrics["total_revenue"], yesterday_summary["total_revenue"], "yesterday")
    food_attach_trend = delta(metrics["food_attach"], yesterday_summary["food_attach"], "yesterday")
    if period != "today":
        revenue_trend = {"direction": "flat", "percent": 0, "label": f"{period_label.lower()} selected"}
        food_attach_trend = {"direction": "flat", "percent": 0, "label": f"{period_label.lower()} selected"}

    return {
        "date": today,
        "period": period,
        "period_label": period_label,
        "generated_at": table_state["generated_at"],
        "metrics": metrics,
        "yesterday": yesterday_summary,
        "trends": {
            "today_revenue": revenue_trend,
            "live_floor_value": {
                "direction": "flat",
                "percent": 0,
                "label": "live estimate now",
            },
            "active_tables": delta(active_tables, yesterday_summary["tables_used"], "tables used yesterday"),
            "food_attach": food_attach_trend,
            "sessions": delta(metrics["sessions"], avg_recent_sessions, "7-day average"),
            "revenue_vs_average": delta(metrics["total_revenue"], avg_recent_revenue, "7-day average"),
        },
        "tables": table_state["tables"],
        "active_sessions": table_state["active_sessions"],
        "rates": table_state["rates"],
        "attention": attention[:8],
    }
