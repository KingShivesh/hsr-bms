from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from database import get_db, get_mutation_db
from deps import get_current_claims, require_admin
from datetime import datetime, timedelta
from collections import defaultdict
import models, io, json, time, csv
from audit import get_controls
from live_state import build_table_state, dashboard_payload
from session_identity import active_session_filter
from money import business_date, business_bounds, day_rows, record_business_date
from reconciliation import reconcile_day, tender_parts
from hsr_config import (
    CSV_PREFIX,
    POOL_TABLES,
    SNOOKER_TABLES,
    TABLE_LABELS,
    TABLE_RATES,
    get_ist_now,
)

router = APIRouter()

@router.get("/session-edits")
def session_edits(from_date: str = "", to_date: str = "", staff: str = "", reason: str = "", category: str = "", export: bool = False, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    from hsr_config import IST_TZ
    query = db.query(models.SessionEvent).filter(models.SessionEvent.event_type == "session_time_edited")
    for value, is_end in ((from_date, False), (to_date, True)):
        if not value:
            continue
        try:
            date = datetime.strptime(value, "%Y-%m-%d").replace(hour=3, tzinfo=IST_TZ)
        except ValueError:
            raise HTTPException(422, "Use YYYY-MM-DD for report dates")
        if is_end:
            query = query.filter(models.SessionEvent.ts < (date + timedelta(days=1)).timestamp() * 1000)
        else:
            query = query.filter(models.SessionEvent.ts >= date.timestamp() * 1000)
    if staff:
        query = query.filter(models.SessionEvent.actor == staff)
    rows = []
    for event in query.order_by(models.SessionEvent.ts.desc()).all():
        metadata = json.loads(event.payload_json or "{}")
        if reason and metadata.get("reason") != reason or category and metadata.get("category") != category:
            continue
        rows.append({"id": event.id, "date": event.date, "table": event.table_id, **metadata})
    if not export:
        return rows
    stream = io.StringIO()
    writer = csv.writer(stream)
    fields = ["date", "table", "staff", "original_duration", "new_duration", "reason_label", "category", "notes", "delta", "late_edit"]
    writer.writerow(fields)
    for row in rows:
        values = [row.get(field, "") for field in fields]
        writer.writerow(["'" + value if isinstance(value, str) and value.startswith(("=", "+", "-", "@")) else value for value in values])
    return StreamingResponse(iter([stream.getvalue()]), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="session-edits.csv"'})
MAX_REPORT_DURATION_MINUTES = 12 * 60
REPORT_TABLES = [table_id.upper() for table_id in TABLE_RATES]

class DayCloseBody(BaseModel):
    opened_float: int = Field(0, ge=0, le=10000000)
    counted_cash: int = Field(0, ge=0, le=10000000)
    notes: str = ""
    business_date: str = ""
    acknowledge_legacy: bool = False

# ── helpers ──
def parse_date(t: models.Transaction):
    try:    return datetime.strptime(t.date, "%d/%m/%Y, %H:%M:%S")
    except: return None

def valid_duration(duration: int | None) -> bool:
    return isinstance(duration, int) and 0 < duration <= MAX_REPORT_DURATION_MINUTES

def valid_report_transaction(t: models.Transaction) -> bool:
    if not valid_duration(t.duration) and not (
        t.tariff_mode in {"frame", "package"} and isinstance(t.duration, int) and t.duration > 0
    ):
        return False
    if not (t.customer_name or "").strip() and (t.total or 0) <= 0 and not t.session_key:
        return False
    return True

def report_transactions(db: Session):
    return [
        t for t in db.query(models.Transaction).all()
        if valid_report_transaction(t)
    ]

def report_transactions_from(query):
    return [
        t for t in query.all()
        if valid_report_transaction(t)
    ]

def today_transactions(db: Session, today: str | None = None):
    return [row for row in day_rows(db, models.Transaction, today) if valid_report_transaction(row)]

def dated_transactions(db: Session, day: datetime):
    return today_transactions(db, day.strftime("%d/%m/%Y"))

def daily_summary_payload(transactions: list[models.Transaction]) -> dict:
    total_sale = sum(t.total for t in transactions)
    total_food = sum(t.food_charge for t in transactions)
    total_sessions = len(transactions)
    return {
        "sale": total_sale,
        "food": total_food,
        "sessions": total_sessions,
        "food_attach": round((total_food / total_sale) * 100) if total_sale else 0,
        "avg_bill": round(total_sale / total_sessions) if total_sessions else 0,
        "tables_used": len({(t.table_id or "").lower() for t in transactions if t.table_id}),
    }

def recent_transactions(db: Session, days: int):
    since_ms = (time.time() - days * 24 * 60 * 60) * 1000
    return report_transactions_from(
        db.query(models.Transaction).filter(models.Transaction.ts >= since_ms)
    )

def filter_transactions(transactions, period: str):
    now = get_ist_now()
    if period == "today":
        today = business_date()
        return [t for t in transactions if record_business_date(t) == today]
    if period == "week":
        week_ago = now - timedelta(days=7)
        return [t for t in transactions if (lambda d: d and d >= week_ago)(parse_date(t))]
    return transactions  # all time

def parse_food_items(raw_items: str | None):
    try:
        parsed = json.loads(raw_items or "[]")
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []

def parse_players(raw_players: str | None, fallback: str = ""):
    try:
        parsed = json.loads(raw_players or "[]")
    except json.JSONDecodeError:
        parsed = []
    players = parsed if isinstance(parsed, list) else []
    clean_players = [str(player).strip() for player in players if str(player or "").strip()]
    if not clean_players and fallback:
        clean_players = [fallback]
    return clean_players

def serialize_closed_frame(frame: models.ClosedSessionFrame):
    return {
        "id": frame.id,
        "table_id": frame.table_id,
        "session_key": frame.session_key or "",
        "frame_no": frame.frame_no,
        "started_at": frame.started_at or 0,
        "ended_at": frame.ended_at or 0,
        "loser_name": frame.loser_name or "",
        "status": frame.status or "closed",
    }

def closed_frames_by_transaction(db: Session, transaction_ids: list[int]):
    if not transaction_ids:
        return {}
    frames = db.query(models.ClosedSessionFrame).filter(
        models.ClosedSessionFrame.transaction_id.in_(transaction_ids)
    ).order_by(
        models.ClosedSessionFrame.transaction_id.asc(),
        models.ClosedSessionFrame.frame_no.asc(),
    ).all()
    by_txn = defaultdict(list)
    for frame in frames:
        by_txn[frame.transaction_id].append(frame)
    return by_txn

def transaction_report_row(t: models.Transaction, frames_by_txn: dict[int, list[models.ClosedSessionFrame]] | None = None):
    frames_by_txn = frames_by_txn or {}
    payment_split = parse_food_items(getattr(t, "payment_split_json", "[]"))
    return {
        "id": t.id,
        "date": t.date,
        "ts": t.ts,
        "tbl": t.table_id,
        "nm": t.customer_name,
        "time_edit": json.loads(t.time_edit_json or "{}") or None,
        "customer_phone": t.customer_phone,
        "player_type": t.player_type,
        "member_id": t.member_id,
        "booking_id": t.booking_id,
        "dur": t.duration,
        "tariff_mode": t.tariff_mode or "hourly",
        "tariff_price": t.tariff_price,
        "tariff_label": t.tariff_label or "",
        "frame_count": t.frame_count or 0,
        "package_id": t.package_id or "",
        "ply": t.play_charge,
        "famt": t.food_charge,
        "food": t.food_items,
        "food_items": parse_food_items(t.food_json),
        "tot": t.total,
        "notes": t.notes or "",
        "billing_mode": getattr(t, "billing_mode", "single") or "single",
        "players": parse_players(getattr(t, "players_json", "[]"), t.customer_name),
        "payer_name": getattr(t, "payer_name", "") or "",
        "split_names": t.split_names or "",
        "payment_method": t.payment_method or "Cash",
        "payment_status": t.payment_status,
        "payment_reference": t.payment_reference or "",
        "payment_split": payment_split,
        "discount_reason": getattr(t, "discount_reason", "") or "",
        "session_key": getattr(t, "session_key", "") or "",
        "session_started_at": getattr(t, "session_started_at", 0) or 0,
        "session_ended_at": getattr(t, "session_ended_at", 0) or 0,
        "frames": [
            serialize_closed_frame(frame)
            for frame in frames_by_txn.get(t.id, [])
        ],
    }

def add_payment_breakdown(payment_breakdown: dict[str, int], method: str, total: int, split_json: str | None = ""):
    from types import SimpleNamespace
    parts = tender_parts(SimpleNamespace(total=total, payment_method=method, payment_split_json=split_json))
    if parts:
        for key, value in parts.items():
            if key in payment_breakdown:
                payment_breakdown[key] += value

# ── Summary ──
@router.get("/summary")
def get_summary(db: Session = Depends(get_db), user: dict = Depends(get_current_claims)):
    if user["role"] == "staff":
        state = build_table_state(db)
        active, total = state["active_tables"], len(TABLE_RATES)
        return {"active_tables": active, "total_tables": total, "idle_tables": state["idle_tables"],
                "occupancy": round(active / total * 100) if total else 0}
    payload = dashboard_payload(db)
    return {
        **payload["metrics"],
        "yesterday": payload["yesterday"],
        "trends": payload["trends"],
    }


@router.get("/dashboard")
def get_dashboard(
    period: str = Query("today", pattern="^(today|week|all)$"),
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    return dashboard_payload(db, period=period)

# ── History ──
@router.get("/history")
def get_history(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    txns = sorted(report_transactions(db), key=lambda t: t.ts or 0, reverse=True)
    frames_by_txn = closed_frames_by_transaction(db, [t.id for t in txns])
    return [
        transaction_report_row(t, frames_by_txn)
        for t in txns
    ]

# ── Filtered CSV export ──
@router.get("/export")
def export_csv(
    period: str = Query("all"),
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    all_txns     = sorted(report_transactions(db), key=lambda t: t.ts or 0, reverse=True)
    transactions = filter_transactions(all_txns, period)
    frames_by_txn = closed_frames_by_transaction(db, [t.id for t in transactions])

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Table", "Customer", "Billing Mode", "Payer", "Duration", "Session Start", "Session End", "Frames", "Play", "Food", "Total", "Notes", "Tariff", "Unit Price", "Package", "Completed Frames"])
    for t in transactions:
        mode = getattr(t, "billing_mode", "single") or "single"
        frames = frames_by_txn.get(t.id, [])
        frame_summary = "; ".join(
            f"F{frame.frame_no} lost by {frame.loser_name or 'unrecorded'}"
            for frame in frames
        )
        writer.writerow([t.date, t.table_id, t.customer_name, mode, t.payer_name or "", t.duration,
                         t.session_started_at or 0, t.session_ended_at or 0, frame_summary,
                         t.play_charge, t.food_charge, t.total, t.notes or "", t.tariff_mode or "hourly",
                         t.tariff_price, t.tariff_label or "", t.frame_count or 0])
    output.seek(0)

    period_label = {"today": "today", "week": "this_week"}.get(period, "all_time")
    return StreamingResponse(
        output, media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={CSV_PREFIX}_{period_label}.csv"}
    )

# ── Top customers ──
@router.get("/top-customers")
def top_customers(
    period: str = Query("month"),
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    all_txns = report_transactions(db)

    now = business_bounds()[0].replace(tzinfo=None)
    if period == "month":
        txns = [t for t in all_txns
                if (record_business_date(t) or "")[3:] == now.strftime("%m/%Y")]
        label = now.strftime("%B %Y")
    elif period == "week":
        week_ago = get_ist_now() - timedelta(days=7)
        txns  = [t for t in all_txns if (lambda d: d and d >= week_ago)(parse_date(t))]
        label = "Last 7 days"
    else:
        txns  = all_txns
        label = "All time"

    customer_stats = defaultdict(lambda: {"visits": 0, "spent": 0, "play": 0, "food": 0})
    for t in txns:
        nm = t.customer_name or "Walk-in Guest"
        customer_stats[nm]["visits"] += 1
        customer_stats[nm]["spent"]  += t.total
        customer_stats[nm]["play"]   += t.play_charge
        customer_stats[nm]["food"]   += t.food_charge

    ranked = sorted(customer_stats.items(), key=lambda x: x[1]["spent"], reverse=True)[:10]
    return {
        "label": label,
        "customers": [
            { "name": nm, **stats }
            for nm, stats in ranked
        ]
    }

# ── Table utilization ──
@router.get("/table-utilization")
def table_utilization(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    txns   = report_transactions(db)
    tables = REPORT_TABLES
    result = []

    for tbl in tables:
        t_txns    = [t for t in txns if t.table_id == tbl]
        sessions  = len(t_txns)
        revenue   = sum(t.total    for t in t_txns)
        avg_dur   = round(sum(t.duration for t in t_txns) / sessions) if sessions else 0
        food_rev  = sum(t.food_charge for t in t_txns)
        tbl_type  = "POOL" if tbl in POOL_TABLES else "SNOOKER"
        result.append({
            "table":    tbl,
            "type":     tbl_type,
            "label":    TABLE_LABELS.get(tbl.lower(), tbl_type.title()),
            "sessions": sessions,
            "revenue":  revenue,
            "avg_dur":  avg_dur,
            "food_rev": food_rev,
        })

    total_sessions = sum(r["sessions"] for r in result)
    for r in result:
        r["utilization_pct"] = round((r["sessions"] / total_sessions * 100)) if total_sessions else 0

    return sorted(result, key=lambda x: x["revenue"], reverse=True)

# ── Daily closing report ──
@router.get("/reconciliation")
def reconciliation_report(day: str = "", db: Session = Depends(get_mutation_db), _: dict = Depends(require_admin)):
    business_bounds(day or None)
    return reconcile_day(db, day or None)

@router.get("/closing-report")
def closing_report(db: Session = Depends(get_mutation_db), day: str = "", _: dict = Depends(require_admin)):
    today = day or business_date()
    business_bounds(today)
    day_close = db.query(models.DayClose).filter_by(business_date=today).first()
    if day_close:
        try:
            snapshot = json.loads(day_close.snapshot_json)
            if not isinstance(snapshot, dict) or snapshot.get("date") != today or "payment_breakdown" not in snapshot:
                raise ValueError("Incomplete snapshot")
        except (ValueError, TypeError):
            raise HTTPException(409, "Saved closing snapshot needs owner review; it will not be recalculated or overwritten.")
        snapshot["day_close"] = {"closed": True, "closed_at": day_close.closed_at,
            "closed_by": day_close.closed_by, "opened_float": day_close.opened_float,
            "counted_cash": day_close.counted_cash, "expected_cash": day_close.expected_cash,
            "variance": day_close.variance, "notes": day_close.notes}
        snapshot["can_close_day"] = False
        snapshot["legacy_close"] = "business_day_cutoff_hour" not in snapshot
        return snapshot
    # EOD must not silently omit a malformed financial row through report filters.
    txns = day_rows(db, models.Transaction, today)
    reconciliation = reconcile_day(db, today)

    total_revenue  = sum(t.total or 0 for t in txns)
    play_revenue   = sum(t.play_charge or 0 for t in txns)
    food_revenue   = sum(t.food_charge or 0 for t in txns)
    total_sessions = len(txns)
    avg_duration   = round(sum(t.duration or 0 for t in txns) / total_sessions) if total_sessions else 0
    payment_breakdown = reconciliation["payment_breakdown"]
    food_only_orders = [row for row in day_rows(db, models.FoodOnlyOrder, today) if not row.cancelled_at]
    food_only_revenue = sum(o.total or 0 for o in food_only_orders)
    food_only_payment_breakdown = reconciliation["counter_payment_breakdown"]
    corrections_today = sorted([row for row in day_rows(db, models.AuditLog, today)
        if row.action in {"session_reset", "daily_reset", "clear_all"}], key=lambda row: row.ts or 0, reverse=True)
    active_sessions = db.query(models.ActiveSession).filter(
        active_session_filter()
    ).all()
    active_table_ids = {s.table_id.lower() for s in active_sessions}
    open_tables = [
        {
            "table_id": s.table_id.upper(),
            "customer_name": s.customer_name,
            "food_total": s.food_total or 0,
            "session_key": getattr(s, "session_key", "") or "",
            "session_started_at": s.start_time or 0,
        }
        for s in active_sessions
    ]
    idle_tables = [
        table_id.upper()
        for table_id in TABLE_RATES
        if table_id.lower() not in active_table_ids
    ]

    # Table breakdown
    table_breakdown = defaultdict(lambda: {"sessions": 0, "revenue": 0})
    for t in txns:
        table_breakdown[t.table_id]["sessions"] += 1
        table_breakdown[t.table_id]["revenue"]  += t.total or 0
    frames_by_txn = closed_frames_by_transaction(db, [t.id for t in txns])

    # Food breakdown
    food_counter = defaultdict(int)
    for t in txns:
        try:
            items = json.loads(t.food_json or "[]")
            for item in items:
                food_counter[item["item"]] += item["qty"]
        except: pass

    # Peak hour
    hour_counter = defaultdict(int)
    for t in txns:
        try:
            dt = datetime.strptime(t.date, "%d/%m/%Y, %H:%M:%S")
            hour_counter[dt.hour] += 1
        except: pass

    peak_hour = max(hour_counter, key=hour_counter.get) if hour_counter else None

    return {
        "date":           today,
        "business_day_cutoff_hour": 3,
        "reconciliation": reconciliation,
        "combined_revenue": total_revenue + food_only_revenue,
        "total_revenue":  total_revenue,
        "play_revenue":   play_revenue,
        "food_revenue":   food_revenue,
        "food_only_revenue": food_only_revenue,
        "food_only_payment_breakdown": food_only_payment_breakdown,
        "cash_total": payment_breakdown["Cash"],
        "upi_total": payment_breakdown["UPI"],
        "card_total": payment_breakdown["Card"],
        "credit_total": payment_breakdown["Credit"],
        "payment_breakdown": payment_breakdown,
        "day_close": {
            "closed": bool(day_close),
            "closed_at": day_close.closed_at if day_close else "",
            "closed_by": day_close.closed_by if day_close else "",
            "opened_float": day_close.opened_float if day_close else 0,
            "counted_cash": day_close.counted_cash if day_close else 0,
            "expected_cash": day_close.expected_cash if day_close else payment_breakdown["Cash"],
            "variance": day_close.variance if day_close else 0,
            "notes": day_close.notes if day_close else "",
        },
        "total_sessions": total_sessions,
        "avg_duration":   avg_duration,
        "active_tables": len(open_tables),
        "open_tables": open_tables,
        "idle_tables": idle_tables,
        "can_close_day": len(open_tables) == 0 and reconciliation["ok"],
        "close_block_reason": "Close all running tables before closing the day." if open_tables else
            "Resolve the ledger discrepancies before closing the day." if not reconciliation["ok"] else "",
        "peak_hour":      f"{peak_hour}:00 – {peak_hour+1}:00" if peak_hour is not None else "—",
        "table_breakdown": dict(table_breakdown),
        "food_breakdown":  dict(food_counter),
        "food_only_orders": [
            {
                "customer_name": o.customer_name,
                "total": o.total,
                "items": parse_food_items(o.items),
                "payment_method": o.payment_method or "Cash",
            }
            for o in food_only_orders
        ],
        "corrections_today": [
            {
                "date": row.date,
                "action": row.action,
                "severity": row.severity,
                "detail": row.detail,
                "amount": row.amount or 0,
            }
            for row in corrections_today
        ],
        "transactions": [
            transaction_report_row(t, frames_by_txn)
            for t in txns
        ]
    }

@router.post("/day-close")
def close_day(
    body: DayCloseBody,
    db: Session = Depends(get_mutation_db),
    user: dict = Depends(require_admin),
):
    day = body.business_date or business_date()
    if business_bounds(day)[0] > business_bounds()[0]:
        raise HTTPException(422, "A future business day cannot be closed")
    if db.query(models.DayClose).filter_by(business_date=day).first():
        raise HTTPException(409, "This day is already closed.")
    report = closing_report(db, day)
    if not report["can_close_day"]:
        raise HTTPException(status_code=400 if report["active_tables"] else 409, detail=report["close_block_reason"])
    if report["reconciliation"]["legacy_review_required"] and not body.acknowledge_legacy:
        raise HTTPException(409, "Review the legacy ledger warnings and confirm that review before closing.")

    expected_cash = report["payment_breakdown"]["Cash"]
    counted_cash = max(0, int(body.counted_cash or 0))
    opened_float = max(0, int(body.opened_float or 0))
    variance = counted_cash - (expected_cash + opened_float)
    existing = db.query(models.DayClose).filter(
        models.DayClose.business_date == report["date"]
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="This day is already closed.")
    row = models.DayClose(business_date=report["date"])
    row.opened_float = opened_float
    row.counted_cash = counted_cash
    row.expected_cash = expected_cash
    row.variance = variance
    row.payment_breakdown_json = json.dumps(report["payment_breakdown"])
    row.snapshot_json = json.dumps(report)
    row.notes = (body.notes or "").strip()
    row.closed_at = get_ist_now().strftime("%d/%m/%Y, %H:%M:%S")
    row.closed_by = user.get("username") or "admin"
    db.add(row)
    db.commit()
    return {
        "ok": True,
        "date": row.business_date,
        "closed_at": row.closed_at,
        "closed_by": row.closed_by,
        "expected_cash": row.expected_cash,
        "opened_float": row.opened_float,
        "counted_cash": row.counted_cash,
        "variance": row.variance,
    }

@router.get("/closing-insights")
def closing_insights(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    today = business_date()
    now = get_ist_now()
    now_ms = time.time() * 1000
    controls = get_controls(db)

    all_txns = recent_transactions(db, 8)
    today_txns = [t for t in all_txns if record_business_date(t) == today]
    prior_txns = []
    week_ago = now - timedelta(days=7)
    for t in all_txns:
        dt = parse_date(t)
        if dt and record_business_date(t) != today and dt >= week_ago:
            prior_txns.append(t)

    today_revenue = sum(t.total for t in today_txns)
    today_sessions = len(today_txns)
    today_food = sum(t.food_charge for t in today_txns)
    avg_prior_daily = round(sum(t.total for t in prior_txns) / 7) if prior_txns else 0

    insights = []
    if today_sessions == 0:
        insights.append({
            "type": "info",
            "title": "No sessions closed yet",
            "detail": "No checkouts are recorded for today.",
        })
    elif avg_prior_daily:
        delta = today_revenue - avg_prior_daily
        pct = round((delta / avg_prior_daily) * 100)
        if abs(pct) >= 15:
            direction = "above" if pct > 0 else "below"
            insights.append({
                "type": "positive" if pct > 0 else "warning",
                "title": f"Revenue is {abs(pct)}% {direction} recent average",
                "detail": f"Today is ₹{today_revenue:,}; recent daily average is about ₹{avg_prior_daily:,}.",
            })

    if today_sessions:
        food_share = round((today_food / max(today_revenue, 1)) * 100)
        if food_share < 15:
            insights.append({
                "type": "warning",
                "title": "Food attachment is low",
                "detail": f"Food is only {food_share}% of today’s revenue. Try combo prompts at checkout.",
            })
        elif food_share >= 35:
            insights.append({
                "type": "positive",
                "title": "Food sales are carrying strong margin",
                "detail": f"Food contributed {food_share}% of today’s revenue.",
            })

    resets_today = [row for row in day_rows(db, models.AuditLog, today)
        if row.action in {"session_reset", "daily_reset", "clear_all"}]
    if resets_today:
        insights.append({
            "type": "critical",
            "title": "Sensitive actions happened today",
            "detail": f"{len(resets_today)} reset/clear action(s) were logged. Review the audit log before closing.",
        })

    active_sessions = db.query(models.ActiveSession).filter(
        active_session_filter()
    ).all()
    flagged = []
    for s in active_sessions:
        if s.paused:
            continue
        elapsed_m = (now_ms - s.start_time) / 1000 / 60 if s.start_time else 0
        if elapsed_m >= controls.alert_unbilled_minutes:
            flagged.append(s.table_id.upper())
    if flagged:
        insights.append({
            "type": "critical",
            "title": "Unclosed table-time risk",
            "detail": f"{', '.join(flagged)} have active unbilled time beyond {controls.alert_unbilled_minutes} minutes.",
        })

    if not insights:
        insights.append({
            "type": "positive",
            "title": "Clean close outlook",
            "detail": "No unusual resets or stale active sessions detected.",
        })

    return {
        "date": today,
        "metrics": {
            "revenue": today_revenue,
            "sessions": today_sessions,
            "food": today_food,
            "recent_average": avg_prior_daily,
        },
        "insights": insights,
    }

# ── Analytics (dashboard charts) ──
@router.get("/analytics")
def get_analytics(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    transactions = recent_transactions(db, 70)

    # Weekly revenue
    weekly = {}
    now = business_bounds()[0].replace(tzinfo=None)
    for i in range(6, -1, -1):
        d   = now - timedelta(days=i)
        key = d.strftime("%d/%m")
        weekly[key] = 0
    for t in transactions:
        try:
            dt  = datetime.strptime(record_business_date(t), "%d/%m/%Y")
            key = dt.strftime("%d/%m")
            if key in weekly:
                weekly[key] += t.total
        except: pass

    # Peak hours heatmap
    peak = defaultdict(int)
    for t in transactions:
        try:
            dt = datetime.strptime(t.date, "%d/%m/%Y, %H:%M:%S")
            peak[f"{dt.weekday()}-{dt.hour}"] += 1
        except: pass

    # Revenue breakdown
    pool_rev    = sum(t.play_charge for t in transactions if t.table_id in POOL_TABLES)
    snooker_rev = sum(t.play_charge for t in transactions if t.table_id in SNOOKER_TABLES)
    food_rev    = sum(t.food_charge for t in transactions)

    # Month over month
    now      = business_bounds()[0].replace(tzinfo=None)
    last_m   = (now.replace(day=1) - timedelta(days=1))
    this_total = sum(t.total for t in transactions
        if (record_business_date(t) or "")[3:] == now.strftime("%m/%Y"))
    last_total = sum(t.total for t in transactions
        if (record_business_date(t) or "")[3:] == last_m.strftime("%m/%Y"))

    return {
        "weekly":    [{"date": k, "revenue": v} for k, v in weekly.items()],
        "peak":      [{"key": k, "count": v} for k, v in peak.items()],
        "breakdown": {"pool": pool_rev, "snooker": snooker_rev, "food": food_rev},
        "mom":       {
            "this_month": this_total, "last_month": last_total,
            "this_label": now.strftime("%b %Y"),
            "last_label": last_m.strftime("%b %Y"),
        }
    }

@router.get("/advanced-analytics")
def advanced_analytics(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    txns = report_transactions(db)

    customer_visits = defaultdict(int)
    customer_spend = defaultdict(int)
    table_profit = defaultdict(lambda: {"sessions": 0, "revenue": 0, "avg_duration": 0})
    hour_sessions = defaultdict(int)
    hour_revenue = defaultdict(int)
    food_sessions = 0

    for t in txns:
      customer_visits[t.customer_name or "Walk-in Guest"] += 1
      customer_spend[t.customer_name or "Walk-in Guest"] += t.total
      if t.food_charge > 0:
          food_sessions += 1
      table_profit[t.table_id]["sessions"] += 1
      table_profit[t.table_id]["revenue"] += t.total
      table_profit[t.table_id]["avg_duration"] += t.duration
      dt = parse_date(t)
      if dt:
          hour_sessions[dt.hour] += 1
          hour_revenue[dt.hour] += t.total

    repeat_customers = sum(1 for visits in customer_visits.values() if visits > 1)
    total_customers = len(customer_visits)
    retention_rate = round((repeat_customers / total_customers) * 100) if total_customers else 0
    food_attachment = round((food_sessions / len(txns)) * 100) if txns else 0

    table_rows = []
    for table, stats in table_profit.items():
        sessions = stats["sessions"]
        table_rows.append({
            "table": table,
            "sessions": sessions,
            "revenue": stats["revenue"],
            "avg_duration": round(stats["avg_duration"] / sessions) if sessions else 0,
            "revenue_per_session": round(stats["revenue"] / sessions) if sessions else 0,
        })

    quiet_hours = [
        {"hour": h, "sessions": hour_sessions.get(h, 0), "revenue": hour_revenue.get(h, 0)}
        for h in range(10, 24)
    ]
    quiet_hours = sorted(quiet_hours, key=lambda x: (x["sessions"], x["revenue"]))[:3]

    return {
        "retention_rate": retention_rate,
        "repeat_customers": repeat_customers,
        "total_customers": total_customers,
        "food_attachment_rate": food_attachment,
        "avg_spend_per_customer": round(sum(customer_spend.values()) / total_customers) if total_customers else 0,
        "table_profitability": sorted(table_rows, key=lambda x: x["revenue"], reverse=True),
        "quiet_hours": quiet_hours,
    }
