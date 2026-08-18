from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from database import get_db
from datetime import datetime, timedelta
from routers.members import update_member_on_checkout
import models, time, math, json, uuid
from typing import Optional
from audit import log_action, require_manager_pin
from pricing import calc_checkout, get_peak_multiplier
from deps import require_admin
from hsr_config import format_ist_now, get_ist_now, rate_for_table
from live_state import build_table_state, serialize_session as serialize_live_session

router = APIRouter()
MAX_SESSION_DURATION_MINUTES = 12 * 60
PAYMENT_METHODS = {"Cash", "UPI", "Card", "Split"}
GENERIC_SESSION_PLAYER_NAMES = {"player one", "player two", "walk in customer"}

class StartSession(BaseModel):
    table_id:      str
    customer_name: str
    rate:          int
    split:         bool = False
    split_name:    str  = ""
    billing_mode:  str  = "single"
    players:       list[str] = Field(default_factory=list)

class FoodItem(BaseModel):
    item: str
    qty:  int
    mrp:  int | None = None
    player_name: str = ""

class Reservation(BaseModel):
    name: str
    time: str

class UpdateNotes(BaseModel):
    notes: str

class CloseFrameBody(BaseModel):
    loser_name: str

class TransferTableBody(BaseModel):
    target_table_id: str

class MaintenanceBody(BaseModel):
    reason: str = "Under maintenance"

def normalize_person_name(name: str) -> str:
    return " ".join((name or "").strip().split())

def normalize_table_id(table_id: str) -> str:
    return (table_id or "").strip().lower()

def active_session_for_table(db: Session, table_id: str):
    normalized = normalize_table_id(table_id)
    if not normalized:
        return None
    rows = db.query(models.ActiveSession).filter(
        func.lower(models.ActiveSession.table_id) == normalized
    ).all()
    return next((row for row in rows if normalize_person_name(row.customer_name)), None) or (rows[0] if rows else None)

def maintenance_for_table(db: Session, table_id: str):
    normalized = normalize_table_id(table_id)
    if not normalized:
        return None
    return db.query(models.TableMaintenance).filter(
        func.lower(models.TableMaintenance.table_id) == normalized
    ).first()

def booking_datetime_from_clock(clock_value: str) -> datetime:
    try:
        hour, minute = [int(part) for part in (clock_value or "").split(":", 1)]
    except ValueError:
        raise HTTPException(status_code=400, detail="Reservation time must be HH:MM.")
    now = get_ist_now()
    booking_dt = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if booking_dt < now - timedelta(minutes=5):
        booking_dt = booking_dt + timedelta(days=1)
    return booking_dt

def complete_matching_booking(db: Session, table_id: str, customer_name: str) -> None:
    table_code = normalize_table_id(table_id).upper()
    booking = (
        db.query(models.Booking)
        .filter(
            models.Booking.status == "booked",
            models.Booking.customer_name.ilike(customer_name),
            models.Booking.table_id.in_([table_code, "ANY"]),
        )
        .order_by(models.Booking.booking_time.asc())
        .first()
    )
    if booking:
        booking.status = "completed"

def is_generic_session_player(name: str) -> bool:
    return normalize_person_name(name).lower() in GENERIC_SESSION_PLAYER_NAMES

def merge_session_player(players: list[str], player_name: str) -> tuple[list[str], str]:
    clean_name = normalize_person_name(player_name)
    lookup = {normalize_person_name(player).lower(): player for player in players}
    existing = lookup.get(clean_name.lower())
    if existing:
        return players, existing
    return [*players, clean_name], clean_name

def is_cigarette_item(name: str) -> bool:
    return "cigarette" in (name or "").lower() or "cigg" in (name or "").lower()

def normalize_billing_mode(mode: str | None, split: bool) -> str:
    mode = (mode or "").strip().lower()
    if mode in {"single", "sharing", "lp"}:
        return mode
    return "lp" if split else "single"

def default_players_for_mode(billing_mode: str) -> list[str]:
    if billing_mode == "single":
        return ["Walk In Customer"]
    return ["Player One", "Player Two"]

def clean_players(primary: str, extra_players: list[str] | None, split_name: str = "") -> list[str]:
    raw = [primary]
    raw.extend(extra_players or [])
    if split_name:
        raw.extend(part.strip() for part in split_name.split(","))

    players = []
    seen = set()
    for name in raw:
        cleaned = " ".join((name or "").strip().split())
        if not cleaned:
            continue
        key = cleaned.lower()
        if key not in seen:
            players.append(cleaned)
            seen.add(key)
    return players

def distribute_amount(amount: int, count: int) -> list[int]:
    if count <= 0:
        return []
    base = amount // count
    remainder = amount % count
    return [base + (1 if index < remainder else 0) for index in range(count)]

def parse_payment_split(raw: str | None, total: int, fallback_method: str) -> tuple[str, list[dict]]:
    fallback_method = fallback_method if fallback_method in {"Cash", "UPI", "Card"} else "Cash"
    if not raw:
        return fallback_method, [{"method": fallback_method, "amount": total}]

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid payment split")
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="Invalid payment split")

    split_rows = []
    for row in parsed:
        if not isinstance(row, dict):
            continue
        method = str(row.get("method") or "").strip()
        amount = int(row.get("amount") or 0)
        if method not in {"Cash", "UPI", "Card"}:
            raise HTTPException(status_code=400, detail="Invalid split payment method")
        if amount < 0:
            raise HTTPException(status_code=400, detail="Split amount cannot be negative")
        if amount > 0:
            split_rows.append({"method": method, "amount": amount})

    if not split_rows:
        raise HTTPException(status_code=400, detail="Enter at least one payment amount")
    if sum(row["amount"] for row in split_rows) != total:
        raise HTTPException(status_code=400, detail="Split payments must match the final bill")
    stored_method = split_rows[0]["method"] if len(split_rows) == 1 else "Split"
    return stored_method, split_rows

def allocate_by_weight(weights: dict[str, int], amount: int) -> dict[str, int]:
    names = list(weights.keys())
    if amount <= 0 or not names:
        return {name: 0 for name in names}
    total_weight = sum(max(0, int(value or 0)) for value in weights.values())
    if total_weight <= 0:
        shares = distribute_amount(amount, len(names))
        return {name: shares[index] for index, name in enumerate(names)}

    allocations = {}
    fractions = []
    for name in names:
        raw = amount * max(0, int(weights.get(name, 0) or 0)) / total_weight
        floor_value = int(math.floor(raw))
        allocations[name] = floor_value
        fractions.append((raw - floor_value, name))

    remainder = amount - sum(allocations.values())
    for _, name in sorted(fractions, reverse=True)[:remainder]:
        allocations[name] += 1
    return allocations

def player_food_totals(food_items: list[dict], players: list[str], fallback_name: str) -> dict[str, int]:
    names = players or ([fallback_name] if fallback_name else [])
    if not names:
        names = ["Unassigned"]
    lookup = {name.lower(): name for name in names}
    fallback = fallback_name if fallback_name in names else names[0]
    totals = {name: 0 for name in names}

    for item in food_items:
        price = int(item.get("price") or 0)
        raw_player = " ".join((item.get("player_name") or "").strip().split())
        player = lookup.get(raw_player.lower(), fallback) if raw_player else fallback
        totals[player] = totals.get(player, 0) + price
    return totals

def build_player_breakdown(
    *,
    players: list[str],
    billing_mode: str,
    payer: str,
    display_customer: str,
    final_total: int,
    food_items: list[dict],
    loss_counts: dict[str, list[int]] | None = None,
) -> list[dict]:
    bill_players = players or ([display_customer] if display_customer else [])
    if billing_mode == "single":
        bill_players = [display_customer or (bill_players[0] if bill_players else "Customer")]

    food_by_player = player_food_totals(food_items, bill_players, display_customer)
    billed_food_total = sum(food_by_player.values())
    if billed_food_total > final_total:
        food_by_player = allocate_by_weight(food_by_player, final_total)
        billed_food_total = final_total

    table_total = max(0, final_total - billed_food_total)
    if billing_mode == "lp":
        loss_weights = {
            player: len((loss_counts or {}).get(player, []))
            for player in bill_players
        }
        table_shares = allocate_by_weight(loss_weights, table_total)
        return [
            {
                "name": player,
                "table": table_shares.get(player, 0),
                "food": food_by_player.get(player, 0),
                "total": table_shares.get(player, 0) + food_by_player.get(player, 0),
            }
            for player in bill_players
        ]

    if billing_mode == "sharing":
        table_shares = distribute_amount(table_total, len(bill_players))
        return [
            {
                "name": player,
                "table": table_shares[index],
                "food": food_by_player.get(player, 0),
                "total": table_shares[index] + food_by_player.get(player, 0),
            }
            for index, player in enumerate(bill_players)
        ]

    payer_name = payer if payer in bill_players else (display_customer or bill_players[0])
    return [
        {
            "name": player,
            "table": table_total if player == payer_name else 0,
            "food": food_by_player.get(player, 0),
            "total": (table_total if player == payer_name else 0) + food_by_player.get(player, 0),
        }
        for player in bill_players
    ]

def new_session_key(table_id: str) -> str:
    return f"{table_id}:{uuid.uuid4().hex}"

def ensure_session_key(db: Session, sess: models.ActiveSession) -> str:
    key = getattr(sess, "session_key", "") or ""
    if key:
        return key
    key = f"{sess.table_id}:{int(sess.start_time or time.time() * 1000)}"
    sess.session_key = key
    db.query(models.SessionFrame).filter(
        models.SessionFrame.table_id == sess.table_id,
        models.SessionFrame.session_key == "",
        models.SessionFrame.session_started_at == sess.start_time,
    ).update({"session_key": key}, synchronize_session=False)
    db.flush()
    return key

def active_session_frames(db: Session, sess: models.ActiveSession) -> list[models.SessionFrame]:
    key = ensure_session_key(db, sess)
    return db.query(models.SessionFrame).filter(
        models.SessionFrame.table_id == sess.table_id,
        or_(
            models.SessionFrame.session_key == key,
            (
                (models.SessionFrame.session_key == "")
                & (models.SessionFrame.session_started_at == sess.start_time)
            ),
        ),
    ).order_by(models.SessionFrame.frame_no.asc()).all()

def serialize_frame(frame: models.SessionFrame) -> dict:
    return {
        "id": frame.id,
        "table_id": frame.table_id,
        "frame_no": frame.frame_no,
        "started_at": frame.started_at,
        "ended_at": frame.ended_at,
        "loser_name": frame.loser_name or "",
        "status": frame.status or "open",
    }

def frame_loss_summary(frames: list[models.SessionFrame]) -> dict[str, list[int]]:
    summary = {}
    for frame in frames:
        if frame.status == "closed" and frame.loser_name:
            summary.setdefault(frame.loser_name, []).append(frame.frame_no)
    return summary

def frame_summary_note(frames: list[models.SessionFrame]) -> str:
    closed = [frame for frame in frames if frame.status == "closed" and frame.loser_name]
    if not closed:
        return ""
    return "Frame losses: " + "; ".join(
        f"F{frame.frame_no} lost by {frame.loser_name}" for frame in closed
    )

def billable_minutes(elapsed_ms: float, min_mins: int = 0) -> int:
    minutes = max(1, int(math.ceil(max(0, elapsed_ms) / 1000 / 60)))
    if min_mins > 0 and minutes < min_mins:
        minutes = min_mins
    return minutes

def checkout_clock_ms(sess: models.ActiveSession, requested_ms: float | None = None) -> float:
    now_ms = time.time() * 1000
    if sess.paused:
        return requested_ms or now_ms
    if requested_ms:
        return min(max(requested_ms, sess.start_time), now_ms)
    return now_ms

def create_frame_for_session(
    db: Session,
    sess: models.ActiveSession,
    frame_no: int,
) -> models.SessionFrame:
    frame = models.SessionFrame(
        table_id=sess.table_id,
        session_key=ensure_session_key(db, sess),
        session_started_at=sess.start_time,
        frame_no=frame_no,
        started_at=time.time() * 1000,
        ended_at=0,
        loser_name="",
        status="open",
    )
    db.add(frame)
    return frame

@router.post("/start")
def start_session(body: StartSession, db: Session = Depends(get_db)):
    table_id = normalize_table_id(body.table_id)
    if not table_id:
        raise HTTPException(status_code=400, detail="Table is required.")
    billing_mode = normalize_billing_mode(body.billing_mode, body.split)
    fallback_players = default_players_for_mode(billing_mode)
    customer_name = normalize_person_name(body.customer_name) or fallback_players[0]
    players = clean_players(customer_name, body.players, body.split_name)
    if billing_mode != "single" and len(players) < 2:
        players = clean_players(players[0] if players else fallback_players[0], fallback_players[1:], "")
    if billing_mode != "single" and len(players) < 2:
        raise HTTPException(status_code=400, detail="Enter at least two players for Sharing or LP.")
    if billing_mode == "single":
        players = [customer_name]
    split_name = ", ".join(players[1:])
    settings = db.query(models.Settings).first()
    rate = rate_for_table(table_id, body.rate, settings)
    maint = maintenance_for_table(db, table_id)
    if maint:
        raise HTTPException(status_code=400, detail=f"Table is under maintenance: {maint.reason}")

    existing = active_session_for_table(db, table_id)
    if existing and normalize_person_name(existing.customer_name):
        raise HTTPException(status_code=400, detail="Session already running")

    sess = existing or models.ActiveSession(table_id=table_id)
    sess.table_id      = table_id
    sess.start_time    = time.time() * 1000
    sess.customer_name = customer_name
    sess.rate          = rate
    sess.food_total    = 0
    sess.food_items    = "[]"
    sess.paused        = False
    sess.elapsed_ms    = 0
    sess.reservation   = None
    sess.notes         = ""
    sess.split         = billing_mode != "single"
    sess.split_name    = split_name
    sess.billing_mode  = billing_mode
    sess.players_json  = json.dumps(players)
    sess.session_key   = new_session_key(table_id)
    if not existing:
        db.add(sess)
    complete_matching_booking(db, table_id, customer_name)
    frames = []
    if billing_mode == "lp" and len(players) > 1:
        frame = create_frame_for_session(db, sess, 1)
        frames.append(frame)
    log_action(
        db,
        "session_start",
        f"{table_id.upper()} started as {billing_mode} at ₹{rate}/hr",
        table_id=table_id,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Session already running")
    for frame in frames:
        db.refresh(frame)
    return {"ok": True, "frames": [serialize_frame(frame) for frame in frames]}

@router.post("/pause/{table_id}")
def pause_session(table_id: str, db: Session = Depends(get_db)):
    sess = active_session_for_table(db, table_id)
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")
    if not sess.paused:
        sess.elapsed_ms = time.time() * 1000 - sess.start_time
        sess.paused     = True
        action = "session_pause"
    else:
        sess.start_time = time.time() * 1000 - sess.elapsed_ms
        sess.paused     = False
        action = "session_resume"
    log_action(db, action, f"{normalize_table_id(table_id).upper()} {action.replace('session_', '')}", table_id=table_id)
    db.commit()
    return {"ok": True, "paused": sess.paused}

@router.get("/quote/{table_id}")
def quote_session(
    table_id:       str,
    payment_method: str = "Cash",
    discount_type:  str = "none",
    discount_value: int = 0,
    closed_at_ms:   float | None = None,
    db: Session = Depends(get_db)
):
    sess = active_session_for_table(db, table_id)
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")

    settings   = db.query(models.Settings).first()
    min_mins   = settings.min_session if settings else 0
    quoted_at_ms = checkout_clock_ms(sess, closed_at_ms)
    session_started_at = sess.start_time
    elapsed_ms = sess.elapsed_ms if sess.paused else quoted_at_ms - sess.start_time
    elapsed_ms = max(0, elapsed_ms)

    minutes = billable_minutes(elapsed_ms, min_mins)
    actual_minutes = minutes
    duration_capped = minutes > MAX_SESSION_DURATION_MINUTES
    if duration_capped:
        minutes = MAX_SESSION_DURATION_MINUTES

    checkout = calc_checkout(
        db,
        minutes=minutes,
        hourly_rate=sess.rate,
        food_total=sess.food_total,
    )
    play      = checkout["play"]
    food      = checkout["food"]
    raw_total = checkout["total"]
    if payment_method not in PAYMENT_METHODS:
        payment_method = "Cash"

    discount_type = (discount_type or "none").strip().lower()
    discount_amount = 0
    if discount_type == "percent_5":
        discount_amount = round(raw_total * 0.05)
    elif discount_type == "percent_10":
        discount_amount = round(raw_total * 0.10)
    elif discount_type == "rupee":
        discount_amount = min(max(discount_value, 0), 50, raw_total)
    elif discount_type != "none":
        raise HTTPException(status_code=400, detail="Invalid discount type")
    total = max(0, raw_total - discount_amount)

    food_items = json.loads(sess.food_items or "[]")
    food_str   = ", ".join(f"{x['item']} x{x['qty']}" for x in food_items) or "None"
    billing_mode = normalize_billing_mode(getattr(sess, "billing_mode", "single"), sess.split)
    players = json.loads(getattr(sess, "players_json", "[]") or "[]")
    if not players:
        players = clean_players(sess.customer_name, [], sess.split_name or "")
    frames = active_session_frames(db, sess)
    if billing_mode == "lp" and any(frame.status == "open" for frame in frames):
        raise HTTPException(status_code=400, detail="Close the running frame before closing the table.")
    billable_frames = [frame for frame in frames if frame.status == "closed"]
    losses_by_player = frame_loss_summary(billable_frames)
    if billing_mode == "single":
        payer = sess.customer_name
    else:
        payer = ""

    if billing_mode == "lp":
        recorded_lp_players = [player for player in players if not is_generic_session_player(player)]
        display_customer = recorded_lp_players[0] if recorded_lp_players else "LP Session"
    else:
        display_customer = payer or sess.customer_name
    share_count = len(players) if billing_mode == "sharing" else 1
    split_per_head = math.ceil(total / share_count) if share_count > 1 else total
    player_breakdown = build_player_breakdown(
        players=players,
        billing_mode=billing_mode,
        payer=payer,
        display_customer=display_customer,
        final_total=total,
        food_items=food_items,
        loss_counts=losses_by_player,
    )
    for item in player_breakdown:
        item["lost_frames"] = losses_by_player.get(item["name"], [])
    if billing_mode == "lp":
        player_breakdown = [
            item for item in player_breakdown
            if not (
                is_generic_session_player(item["name"])
                and item["total"] == 0
                and not item["lost_frames"]
            )
        ]

    return {
        "tbl": normalize_table_id(table_id).upper(),
        "nm": display_customer,
        "dur": minutes,
        "actual_dur": actual_minutes,
        "duration_capped": duration_capped,
        "ply": play,
        "famt": food,
        "food": food_str,
        "tot": total,
        "raw_total": raw_total,
        "discount_amount": discount_amount,
        "discount_type": discount_type,
        "subtotal": checkout["subtotal"],
        "gst_amt": checkout["gst_amt"],
        "gst_percent": checkout["gst_percent"],
        "peak_surcharge": checkout["peak_surcharge"],
        "peak_label": checkout["peak_label"],
        "payment_method": payment_method,
        "billing_mode": billing_mode,
        "session_started_at": session_started_at,
        "session_ended_at": quoted_at_ms,
        "players": players,
        "payer_name": payer,
        "split_per_head": split_per_head,
        "share_count": share_count,
        "player_breakdown": player_breakdown,
        "frames": [serialize_frame(frame) for frame in billable_frames],
        "quote": True,
    }

@router.post("/stop/{table_id}")
def stop_session(
    table_id:       str,
    payment_method: str = "Cash",   # Cash / UPI
    payer_name:     str = "",
    discount_type:  str = "none",
    discount_value: int = 0,
    closed_at_ms:   float | None = None,
    discount_reason: str = "",
    payment_split_json: str = "",
    db: Session = Depends(get_db)
):
    sess = active_session_for_table(db, table_id)
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")

    # Minimum session check
    settings   = db.query(models.Settings).first()
    min_mins   = settings.min_session if settings else 0
    closed_at_ms = checkout_clock_ms(sess, closed_at_ms)
    session_started_at = sess.start_time
    elapsed_ms = sess.elapsed_ms if sess.paused else closed_at_ms - sess.start_time
    elapsed_ms = max(0, elapsed_ms)

    minutes = billable_minutes(elapsed_ms, min_mins)
    actual_minutes = minutes
    duration_capped = minutes > MAX_SESSION_DURATION_MINUTES
    if duration_capped:
        minutes = MAX_SESSION_DURATION_MINUTES
    checkout = calc_checkout(
        db,
        minutes=minutes,
        hourly_rate=sess.rate,
        food_total=sess.food_total,
    )

    play            = checkout["play"]
    food            = checkout["food"]
    raw_total       = checkout["total"]
    if payment_method not in PAYMENT_METHODS:
        payment_method = "Cash"
    discount_type = (discount_type or "none").strip().lower()
    discount_amount = 0
    if discount_type == "percent_5":
        discount_amount = round(raw_total * 0.05)
    elif discount_type == "percent_10":
        discount_amount = round(raw_total * 0.10)
    elif discount_type == "rupee":
        discount_amount = min(max(discount_value, 0), 50, raw_total)
    elif discount_type != "none":
        raise HTTPException(status_code=400, detail="Invalid discount type")
    total = max(0, raw_total - discount_amount)
    discount_reason = normalize_person_name(discount_reason)
    if discount_amount > 0 and not discount_reason:
        raise HTTPException(status_code=400, detail="Enter a reason for the discount.")
    payment_method, payment_split = parse_payment_split(
        payment_split_json,
        total,
        payment_method,
    )

    food_items = json.loads(sess.food_items or "[]")
    food_str   = ", ".join(f"{x['item']} x{x['qty']}" for x in food_items) or "None"
    billing_mode = normalize_billing_mode(getattr(sess, "billing_mode", "single"), sess.split)
    players = json.loads(getattr(sess, "players_json", "[]") or "[]")
    if not players:
        players = clean_players(sess.customer_name, [], sess.split_name or "")
    frames = active_session_frames(db, sess)
    if billing_mode == "lp" and any(frame.status == "open" for frame in frames):
        raise HTTPException(status_code=400, detail="Close the running frame before closing the table.")
    billable_frames = [frame for frame in frames if frame.status == "closed"]
    losses_by_player = frame_loss_summary(billable_frames)
    if billing_mode == "single":
        payer = sess.customer_name
    elif billing_mode == "lp":
        payer = ""
    else:
        payer = ""

    if billing_mode == "lp":
        recorded_lp_players = [player for player in players if not is_generic_session_player(player)]
        display_customer = recorded_lp_players[0] if recorded_lp_players else "LP Session"
    else:
        display_customer = payer or sess.customer_name
    share_count = len(players) if billing_mode == "sharing" else 1
    split_per_head = math.ceil(total / share_count) if share_count > 1 else total
    player_breakdown = build_player_breakdown(
        players=players,
        billing_mode=billing_mode,
        payer=payer,
        display_customer=display_customer,
        final_total=total,
        food_items=food_items,
        loss_counts=losses_by_player,
    )
    for item in player_breakdown:
        item["lost_frames"] = losses_by_player.get(item["name"], [])
    if billing_mode == "lp":
        player_breakdown = [
            item for item in player_breakdown
            if not (
                is_generic_session_player(item["name"])
                and item["total"] == 0
                and not item["lost_frames"]
            )
        ]
    transaction_players = (
        [item["name"] for item in player_breakdown]
        if billing_mode == "lp" and player_breakdown
        else players
    )
    notes = sess.notes or ""
    if duration_capped:
        cap_note = f"Duration capped at {minutes} min; actual elapsed {actual_minutes} min"
        notes = f"{notes} | {cap_note}" if notes else cap_note
    if billing_mode == "lp":
        lp_note = "LP settled by recorded frame losses"
        notes = f"{notes} | {lp_note}" if notes else lp_note
    elif billing_mode == "sharing":
        share_note = f"Sharing between {share_count} players; approx ₹{split_per_head} each"
        notes = f"{notes} | {share_note}" if notes else share_note
    if discount_amount > 0:
        discount_note = f"Discount ₹{discount_amount} applied; original total ₹{raw_total}; reason: {discount_reason}"
        notes = f"{notes} | {discount_note}" if notes else discount_note
    if payment_method == "Split":
        payment_note = "Payment split: " + ", ".join(
            f"{row['method']} ₹{row['amount']}" for row in payment_split
        )
        notes = f"{notes} | {payment_note}" if notes else payment_note
    if len(player_breakdown) > 1 or any(item["food"] for item in player_breakdown):
        settlement_note = "Settlement: " + "; ".join(
            f"{item['name']} ₹{item['total']} (table ₹{item['table']}, food ₹{item['food']})"
            for item in player_breakdown
        )
        notes = f"{notes} | {settlement_note}" if notes else settlement_note
    frames_note = frame_summary_note(billable_frames)
    if frames_note:
        notes = f"{notes} | {frames_note}" if notes else frames_note
    serialized_frames = [serialize_frame(frame) for frame in billable_frames]

    t = models.Transaction(
        date          = format_ist_now(),
        ts            = time.time() * 1000,
        table_id      = table_id.upper(),
        customer_name = display_customer,
        duration      = minutes,
        play_charge   = play,
        food_charge   = food,
        food_items    = food_str,
        food_json     = sess.food_items,
        total         = total,
        notes         = notes,
        split         = billing_mode != "single",
        split_names   = ", ".join(transaction_players[1:]),
        billing_mode  = billing_mode,
        players_json  = json.dumps(transaction_players),
        payer_name    = payer,
        gst_amt       = checkout["gst_amt"],
        peak_surcharge = checkout["peak_surcharge"],
        payment_method = payment_method,
        payment_split_json = json.dumps(payment_split),
        discount_reason = discount_reason,
    )
    db.add(t)
    if player_breakdown:
        for item in player_breakdown:
            update_member_on_checkout(item["name"], item["total"], db)
    else:
        update_member_on_checkout(display_customer, total, db)

    for frame in frames:
        db.delete(frame)
    db.delete(sess)
    log_action(
        db,
        "session_close",
        f"{table_id.upper()} closed for ₹{total} via {payment_method}",
        amount=total,
        table_id=table_id,
    )
    db.commit()

    return {
        "date":  t.date,  "ts":    t.ts,
        "tbl":   t.table_id, "nm": t.customer_name,
        "dur":   t.duration, "ply": t.play_charge,
        "actual_dur": actual_minutes,
        "duration_capped": duration_capped,
        "famt":  t.food_charge, "food": t.food_items,
        "tot":   t.total,  "notes": t.notes,
        "raw_total": raw_total,
        "discount_amount": discount_amount,
        "discount_type": discount_type,
        "subtotal": checkout["subtotal"],
        "gst_amt": checkout["gst_amt"],
        "gst_percent": checkout["gst_percent"],
        "peak_surcharge": checkout["peak_surcharge"],
        "peak_label": checkout["peak_label"],
        "payment_method": payment_method,
        "payment_split": payment_split,
        "discount_reason": discount_reason,
        "billing_mode": billing_mode,
        "session_started_at": session_started_at,
        "session_ended_at": closed_at_ms,
        "players": transaction_players,
        "payer_name": payer,
        "split_per_head": split_per_head,
        "share_count": share_count,
        "player_breakdown": player_breakdown,
        "frames": serialized_frames,
    }

@router.post("/transfer/{table_id}")
def transfer_session(
    table_id: str,
    body: TransferTableBody,
    db: Session = Depends(get_db),
):
    source_id = normalize_table_id(table_id)
    target_id = normalize_table_id(body.target_table_id)
    if not source_id or not target_id:
        raise HTTPException(status_code=400, detail="Choose a source and target table.")
    if source_id == target_id:
        raise HTTPException(status_code=400, detail="Choose a different table.")

    sess = active_session_for_table(db, source_id)
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")
    if active_session_for_table(db, target_id):
        raise HTTPException(status_code=400, detail="Target table already has a running session.")
    maint = maintenance_for_table(db, target_id)
    if maint:
        raise HTTPException(status_code=400, detail=f"Target table is under maintenance: {maint.reason}")

    settings = db.query(models.Settings).first()
    old_rate = sess.rate
    new_rate = rate_for_table(target_id, old_rate, settings)
    old_key = ensure_session_key(db, sess)
    new_key = new_session_key(target_id)
    frames = active_session_frames(db, sess)

    sess.table_id = target_id
    sess.rate = new_rate
    sess.session_key = new_key
    for frame in frames:
        frame.table_id = target_id
        frame.session_key = new_key

    log_action(
        db,
        "session_transfer",
        f"{source_id.upper()} transferred to {target_id.upper()} (₹{old_rate}/hr to ₹{new_rate}/hr)",
        table_id=source_id,
    )
    log_action(
        db,
        "session_transfer",
        f"{source_id.upper()} transferred to {target_id.upper()}",
        table_id=target_id,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Target table already has a running session.")
    db.refresh(sess)
    return {
        "ok": True,
        "from": source_id,
        "to": target_id,
        "rate": new_rate,
        "session_key": new_key,
        "previous_session_key": old_key,
    }

@router.post("/reset/{table_id}")
def reset_session(
    table_id: str,
    manager_pin: str = "",
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    require_manager_pin(db, manager_pin)
    sess = active_session_for_table(db, table_id)
    if sess:
        elapsed_ms = sess.elapsed_ms if sess.paused else time.time() * 1000 - sess.start_time
        log_action(
            db,
            "session_reset",
            f"{table_id.upper()} reset while assigned to {sess.customer_name}",
            severity="critical",
            amount=math.ceil((elapsed_ms / 1000) / 60),
            table_id=table_id,
        )
        for frame in active_session_frames(db, sess):
            db.delete(frame)
        db.delete(sess)
        db.commit()
    return {"ok": True}

@router.post("/{table_id}/frames/start")
def start_frame(table_id: str, db: Session = Depends(get_db)):
    sess = active_session_for_table(db, table_id)
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")
    if sess.paused:
        raise HTTPException(status_code=400, detail="Resume the table before starting a frame.")
    frames = active_session_frames(db, sess)
    open_frame = next((frame for frame in frames if frame.status == "open"), None)
    if open_frame:
        return {"ok": True, "frame": serialize_frame(open_frame), "frames": [serialize_frame(frame) for frame in frames]}

    frame = create_frame_for_session(
        db,
        sess,
        max((existing.frame_no for existing in frames), default=0) + 1,
    )
    log_action(db, "frame_start", f"Frame {frame.frame_no} started", table_id=table_id)
    db.commit()
    db.refresh(frame)
    frames = active_session_frames(db, sess)
    return {"ok": True, "frame": serialize_frame(frame), "frames": [serialize_frame(item) for item in frames]}

@router.post("/{table_id}/frames/close")
def close_frame(table_id: str, body: CloseFrameBody, db: Session = Depends(get_db)):
    sess = active_session_for_table(db, table_id)
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")
    if sess.paused:
        raise HTTPException(status_code=400, detail="Resume the table before closing a frame.")
    loser_name = normalize_person_name(body.loser_name)
    if not loser_name:
        raise HTTPException(status_code=400, detail="Enter who lost this frame.")
    players = json.loads(getattr(sess, "players_json", "[]") or "[]")
    if not players:
        players = clean_players(sess.customer_name, [], sess.split_name or "")
    players, loser_name = merge_session_player(players, loser_name)
    sess.players_json = json.dumps(players)
    sess.split_name = ", ".join(players[1:])

    frames = active_session_frames(db, sess)
    open_frame = next((frame for frame in frames if frame.status == "open"), None)
    if not open_frame:
        raise HTTPException(status_code=400, detail="Start a frame before closing it.")
    open_frame.status = "closed"
    open_frame.ended_at = time.time() * 1000
    open_frame.loser_name = loser_name
    log_action(db, "frame_close", f"Frame {open_frame.frame_no} lost by {loser_name}", table_id=table_id)
    db.commit()
    frames = active_session_frames(db, sess)
    return {
        "ok": True,
        "frame": serialize_frame(open_frame),
        "frames": [serialize_frame(frame) for frame in frames],
        "players": players,
    }

@router.post("/{table_id}/food")
def add_food(table_id: str, body: FoodItem, db: Session = Depends(get_db)):
    if body.qty <= 0:
        raise HTTPException(status_code=400, detail="Item quantity must be greater than 0")
    sess = active_session_for_table(db, table_id)
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")
    menu_item = db.query(models.MenuItem).filter(
        models.MenuItem.name == body.item
    ).first()
    if not menu_item:
        raise HTTPException(status_code=404, detail="Item not in menu")
    if not menu_item.available:
        raise HTTPException(status_code=400, detail=f"{body.item} is currently unavailable")
    item_name = body.item
    if is_cigarette_item(body.item):
        if not body.mrp or body.mrp <= 0:
            raise HTTPException(status_code=400, detail="Enter cigarette price")
        unit_price = body.mrp + 3
        item_name = f"{body.item} (MRP ₹{body.mrp} + ₹3)"
    else:
        unit_price = menu_item.price
    price           = unit_price * body.qty
    items           = json.loads(sess.food_items or "[]")
    player_name = " ".join((body.player_name or "").strip().split())
    if player_name:
        players = json.loads(getattr(sess, "players_json", "[]") or "[]")
        if not players:
            players = clean_players(sess.customer_name, [], sess.split_name or "")
        player_lookup = {player.lower(): player for player in players}
        if player_name.lower() not in player_lookup:
            raise HTTPException(status_code=400, detail="Select a valid player for this table.")
        player_name = player_lookup[player_name.lower()]
    line = {"item": item_name, "qty": body.qty, "price": price}
    if player_name:
        line["player_name"] = player_name
    items.append(line)
    sess.food_items  = json.dumps(items)
    sess.food_total += price
    log_action(
        db,
        "food_add",
        f"{table_id.upper()} added {line['item']} x{body.qty}",
        amount=price,
        table_id=table_id,
    )
    db.commit()
    return {"ok": True, "food_total": sess.food_total}

@router.post("/{table_id}/notes")
def update_notes(table_id: str, body: UpdateNotes, db: Session = Depends(get_db)):
    sess = active_session_for_table(db, table_id)
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")
    sess.notes = body.notes
    db.commit()
    return {"ok": True}

@router.post("/{table_id}/reserve")
def reserve(table_id: str, body: Reservation, db: Session = Depends(get_db)):
    table_id = normalize_table_id(table_id)
    name = normalize_person_name(body.name)
    if not name:
        raise HTTPException(status_code=400, detail="Reservation name is required.")
    sess = active_session_for_table(db, table_id)
    if sess and normalize_person_name(sess.customer_name):
        raise HTTPException(status_code=400, detail="Table is already running.")
    booking_dt = booking_datetime_from_clock(body.time)
    duration = 60
    booking_end = booking_dt + timedelta(minutes=duration)
    table_code = table_id.upper()
    existing = db.query(models.Booking).filter(models.Booking.status == "booked").all()
    for booking in existing:
        if (booking.table_id or "").upper() != table_code:
            continue
        existing_start = datetime.fromisoformat(booking.booking_time)
        existing_end = existing_start + timedelta(minutes=booking.duration_mins)
        if booking_dt < existing_end and booking_end > existing_start:
            raise HTTPException(status_code=400, detail=f"Booking conflict on {table_code}")
    booking = models.Booking(
        customer_name=name,
        phone="",
        table_id=table_code,
        table_type="POOL" if table_id == "t5" else "SNOOKER",
        booking_time=booking_dt.isoformat(timespec="minutes"),
        duration_mins=duration,
        notes="Quick table reservation",
        status="booked",
        created_at=get_ist_now().strftime("%d/%m/%Y, %H:%M"),
        ts=time.time() * 1000,
    )
    db.add(booking)
    if sess and not normalize_person_name(sess.customer_name):
        db.delete(sess)
    db.commit()
    db.refresh(booking)
    return {"ok": True, "booking_id": booking.id}

@router.delete("/{table_id}/reserve")
def cancel_reserve(table_id: str, db: Session = Depends(get_db)):
    sess = active_session_for_table(db, table_id)
    table_code = normalize_table_id(table_id).upper()
    booking = (
        db.query(models.Booking)
        .filter(models.Booking.status == "booked", models.Booking.table_id == table_code)
        .order_by(models.Booking.booking_time.asc())
        .first()
    )
    if booking:
        booking.status = "cancelled"
    if sess and not normalize_person_name(sess.customer_name):
        db.delete(sess)
    if booking or sess:
        db.commit()
    return {"ok": True}

@router.get("/active")
def get_active(db: Session = Depends(get_db)):
    sessions = db.query(models.ActiveSession).all()
    result = []
    for s in sessions:
        if not s.customer_name:
            continue
        result.append(serialize_live_session(db, s))
    return result


@router.get("/tables")
def get_table_state(db: Session = Depends(get_db)):
    return build_table_state(db)

@router.get("/history/{table_id}")
def table_history(table_id: str, db: Session = Depends(get_db)):
    txns = db.query(models.Transaction).filter(
        models.Transaction.table_id == normalize_table_id(table_id).upper()
    ).order_by(models.Transaction.ts.desc()).limit(10).all()
    return [
        {
            "date":  t.date, "nm": t.customer_name,
            "dur":   t.duration, "tot": t.total,
            "notes": t.notes or "",
            "payment_method": t.payment_method or "Cash",
            "billing_mode": getattr(t, "billing_mode", "single") or "single",
            "players": json.loads(getattr(t, "players_json", "[]") or "[]"),
            "payer_name": getattr(t, "payer_name", "") or "",
        }
        for t in txns
    ]

@router.get("/audit/{table_id}")
def table_audit(table_id: str, limit: int = 30, db: Session = Depends(get_db)):
    table_code = normalize_table_id(table_id).upper()
    rows = db.query(models.AuditLog).filter(
        func.upper(models.AuditLog.table_id) == table_code
    ).order_by(models.AuditLog.ts.desc()).limit(max(1, min(limit, 100))).all()
    return [
        {
            "date": row.date,
            "ts": row.ts,
            "table_id": row.table_id,
            "action": row.action,
            "severity": row.severity,
            "detail": row.detail,
            "amount": row.amount or 0,
        }
        for row in rows
    ]

@router.post("/maintenance/{table_id}")
def set_maintenance(table_id: str, body: MaintenanceBody, db: Session = Depends(get_db)):
    table_id = normalize_table_id(table_id)
    existing = maintenance_for_table(db, table_id)
    if existing:
        existing.reason = body.reason
        existing.since  = get_ist_now().strftime("%d/%m/%Y, %H:%M")
    else:
        db.add(models.TableMaintenance(
            table_id = table_id,
            reason   = body.reason,
            since    = get_ist_now().strftime("%d/%m/%Y, %H:%M"),
        ))
    db.commit()
    return {"ok": True}

@router.delete("/maintenance/{table_id}")
def clear_maintenance(table_id: str, db: Session = Depends(get_db)):
    m = maintenance_for_table(db, table_id)
    if m:
        db.delete(m)
        db.commit()
    return {"ok": True}

@router.get("/maintenance")
def get_maintenance(db: Session = Depends(get_db)):
    items = db.query(models.TableMaintenance).all()
    return {normalize_table_id(m.table_id): {"reason": m.reason, "since": m.since} for m in items}
