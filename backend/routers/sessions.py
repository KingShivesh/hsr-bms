from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from database import get_db
from datetime import datetime
from routers.members import update_member_on_checkout
import models, time, math, json
from typing import Optional
from audit import get_controls, log_action
from pricing import calc_checkout, get_peak_multiplier
from validators import require_full_name
from hsr_config import rate_for_table

router = APIRouter()
MAX_SESSION_DURATION_MINUTES = 12 * 60
PAYMENT_METHODS = {"Cash", "UPI", "Card"}

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

class MaintenanceBody(BaseModel):
    reason: str = "Under maintenance"

def is_cigarette_item(name: str) -> bool:
    return "cigarette" in (name or "").lower() or "cigg" in (name or "").lower()

def normalize_billing_mode(mode: str | None, split: bool) -> str:
    mode = (mode or "").strip().lower()
    if mode in {"single", "sharing", "lp"}:
        return mode
    return "lp" if split else "single"

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

@router.post("/start")
def start_session(body: StartSession, db: Session = Depends(get_db)):
    customer_name = require_full_name(body.customer_name, "Customer name")
    billing_mode = normalize_billing_mode(body.billing_mode, body.split)
    players = clean_players(customer_name, body.players, body.split_name)
    if billing_mode != "single" and len(players) < 2:
        raise HTTPException(status_code=400, detail="Enter at least two players for Sharing or LP.")
    for index, player in enumerate(players):
        require_full_name(player, f"Player {index + 1} name")
    if billing_mode == "single":
        players = [customer_name]
    split_name = ", ".join(players[1:])
    settings = db.query(models.Settings).first()
    rate = rate_for_table(body.table_id, body.rate, settings)
    maint = db.query(models.TableMaintenance).filter(
        models.TableMaintenance.table_id == body.table_id
    ).first()
    if maint:
        raise HTTPException(status_code=400, detail=f"Table is under maintenance: {maint.reason}")

    existing = db.query(models.ActiveSession).filter(
        models.ActiveSession.table_id == body.table_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Session already running")

    db.add(models.ActiveSession(
        table_id      = body.table_id,
        start_time    = time.time() * 1000,
        customer_name = customer_name,
        rate          = rate,
        food_total    = 0,
        food_items    = "[]",
        paused        = False,
        elapsed_ms    = 0,
        reservation   = None,
        notes         = "",
        split         = billing_mode != "single",
        split_name    = split_name,
        billing_mode  = billing_mode,
        players_json  = json.dumps(players),
    ))
    db.commit()
    return {"ok": True}

@router.post("/pause/{table_id}")
def pause_session(table_id: str, db: Session = Depends(get_db)):
    sess = db.query(models.ActiveSession).filter(
        models.ActiveSession.table_id == table_id
    ).first()
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")
    if not sess.paused:
        sess.elapsed_ms = time.time() * 1000 - sess.start_time
        sess.paused     = True
    else:
        sess.start_time = time.time() * 1000 - sess.elapsed_ms
        sess.paused     = False
    db.commit()
    return {"ok": True, "paused": sess.paused}

@router.post("/stop/{table_id}")
def stop_session(
    table_id:       str,
    payment_method: str = "Cash",   # Cash / UPI
    payer_name:     str = "",
    discount_type:  str = "none",
    discount_value: int = 0,
    db: Session = Depends(get_db)
):
    sess = db.query(models.ActiveSession).filter(
        models.ActiveSession.table_id == table_id
    ).first()
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")

    # Minimum session check
    settings   = db.query(models.Settings).first()
    min_mins   = settings.min_session if settings else 0
    elapsed_ms = sess.elapsed_ms if sess.paused else time.time() * 1000 - sess.start_time
    elapsed_ms = max(0, elapsed_ms)
    elapsed_m  = elapsed_ms / 1000 / 60

    minutes = max(1, int(math.floor((elapsed_ms / 1000 / 60) + 0.5)))
    if min_mins > 0 and minutes < min_mins:
        minutes = min_mins
    if minutes > MAX_SESSION_DURATION_MINUTES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Session duration looks invalid. Please reset this table or "
                "contact the owner before closing."
            ),
        )
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

    food_items = json.loads(sess.food_items or "[]")
    food_str   = ", ".join(f"{x['item']} x{x['qty']}" for x in food_items) or "None"
    billing_mode = normalize_billing_mode(getattr(sess, "billing_mode", "single"), sess.split)
    players = json.loads(getattr(sess, "players_json", "[]") or "[]")
    if not players:
        players = clean_players(sess.customer_name, [], sess.split_name or "")
    if billing_mode == "single":
        payer = sess.customer_name
    elif billing_mode == "lp":
        payer = " ".join((payer_name or "").strip().split())
        if not payer:
            raise HTTPException(status_code=400, detail="Select who pays for this LP session.")
        player_lookup = {player.lower(): player for player in players}
        if payer.lower() not in player_lookup:
            raise HTTPException(status_code=400, detail="Payer must be one of the session players.")
        payer = player_lookup[payer.lower()]
    else:
        payer = ""

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
    )
    notes = sess.notes or ""
    if billing_mode == "lp" and payer:
        winners = [player for player in players if player.lower() != payer.lower()]
        lp_note = f"LP paid by {payer}"
        if winners:
            lp_note += f"; other player(s): {', '.join(winners)}"
        notes = f"{notes} | {lp_note}" if notes else lp_note
    elif billing_mode == "sharing":
        share_note = f"Sharing between {share_count} players; approx ₹{split_per_head} each"
        notes = f"{notes} | {share_note}" if notes else share_note
    if discount_amount > 0:
        discount_note = f"Discount ₹{discount_amount} applied; original total ₹{raw_total}"
        notes = f"{notes} | {discount_note}" if notes else discount_note
    if len(player_breakdown) > 1 or any(item["food"] for item in player_breakdown):
        settlement_note = "Settlement: " + "; ".join(
            f"{item['name']} ₹{item['total']} (table ₹{item['table']}, food ₹{item['food']})"
            for item in player_breakdown
        )
        notes = f"{notes} | {settlement_note}" if notes else settlement_note

    t = models.Transaction(
        date          = datetime.now().strftime("%d/%m/%Y, %H:%M:%S"),
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
        split_names   = ", ".join(players[1:]),
        billing_mode  = billing_mode,
        players_json  = json.dumps(players),
        payer_name    = payer,
        gst_amt       = checkout["gst_amt"],
        peak_surcharge = checkout["peak_surcharge"],
        payment_method = payment_method,
    )
    db.add(t)
    if player_breakdown:
        for item in player_breakdown:
            update_member_on_checkout(item["name"], item["total"], db)
    else:
        update_member_on_checkout(display_customer, total, db)

    db.delete(sess)
    db.commit()

    return {
        "date":  t.date,  "ts":    t.ts,
        "tbl":   t.table_id, "nm": t.customer_name,
        "dur":   t.duration, "ply": t.play_charge,
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
        "billing_mode": billing_mode,
        "players": players,
        "payer_name": payer,
        "split_per_head": split_per_head,
        "share_count": share_count,
        "player_breakdown": player_breakdown,
    }

@router.post("/reset/{table_id}")
def reset_session(table_id: str, manager_pin: str = "", db: Session = Depends(get_db)):
    sess = db.query(models.ActiveSession).filter(
        models.ActiveSession.table_id == table_id
    ).first()
    if sess:
        elapsed_ms = sess.elapsed_ms if sess.paused else time.time() * 1000 - sess.start_time
        log_action(
            db,
            "session_reset",
            f"{table_id.upper()} reset while assigned to {sess.customer_name}",
            severity="critical",
            amount=math.ceil((elapsed_ms / 1000) / 60),
        )
        db.delete(sess)
        db.commit()
    return {"ok": True}

@router.post("/{table_id}/food")
def add_food(table_id: str, body: FoodItem, db: Session = Depends(get_db)):
    if body.qty <= 0:
        raise HTTPException(status_code=400, detail="Item quantity must be greater than 0")
    sess = db.query(models.ActiveSession).filter(
        models.ActiveSession.table_id == table_id
    ).first()
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
    db.commit()
    return {"ok": True, "food_total": sess.food_total}

@router.post("/{table_id}/notes")
def update_notes(table_id: str, body: UpdateNotes, db: Session = Depends(get_db)):
    sess = db.query(models.ActiveSession).filter(
        models.ActiveSession.table_id == table_id
    ).first()
    if not sess:
        raise HTTPException(status_code=404, detail="No active session")
    sess.notes = body.notes
    db.commit()
    return {"ok": True}

@router.post("/{table_id}/reserve")
def reserve(table_id: str, body: Reservation, db: Session = Depends(get_db)):
    sess = db.query(models.ActiveSession).filter(
        models.ActiveSession.table_id == table_id
    ).first()
    if not sess:
        sess = models.ActiveSession(
            table_id=table_id, start_time=0, customer_name="",
            rate=0, food_total=0, food_items="[]", paused=False, elapsed_ms=0
        )
        db.add(sess)
    sess.reservation = json.dumps({"name": body.name, "time": body.time})
    db.commit()
    return {"ok": True}

@router.delete("/{table_id}/reserve")
def cancel_reserve(table_id: str, db: Session = Depends(get_db)):
    sess = db.query(models.ActiveSession).filter(
        models.ActiveSession.table_id == table_id
    ).first()
    if sess:
        sess.reservation = None
        db.commit()
    return {"ok": True}

@router.get("/active")
def get_active(db: Session = Depends(get_db)):
    sessions = db.query(models.ActiveSession).all()
    controls = get_controls(db)
    now_ms = time.time() * 1000
    return [
        {
            "table_id":      s.table_id,
            "customer_name": s.customer_name,
            "rate":          s.rate,
            "start_time":    s.start_time,
            "elapsed_ms":    s.elapsed_ms,
            "paused":        s.paused,
            "food_total":    s.food_total,
            "food_items":    json.loads(s.food_items or "[]"),
            "reservation":   json.loads(s.reservation) if s.reservation else None,
            "notes":         s.notes or "",
            "split":         s.split,
            "split_name":    s.split_name or "",
            "billing_mode":  normalize_billing_mode(getattr(s, "billing_mode", "single"), s.split),
            "players":       json.loads(getattr(s, "players_json", "[]") or "[]") or clean_players(s.customer_name, [], s.split_name or ""),
            "leakage_alert":  (
                controls.alert_unbilled_minutes > 0
                and not s.paused
                and s.start_time
                and ((now_ms - s.start_time) / 1000 / 60) >= controls.alert_unbilled_minutes
            ),
        }
        for s in sessions if s.customer_name
    ]

@router.get("/history/{table_id}")
def table_history(table_id: str, db: Session = Depends(get_db)):
    txns = db.query(models.Transaction).filter(
        models.Transaction.table_id == table_id.upper()
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

@router.post("/maintenance/{table_id}")
def set_maintenance(table_id: str, body: MaintenanceBody, db: Session = Depends(get_db)):
    existing = db.query(models.TableMaintenance).filter(
        models.TableMaintenance.table_id == table_id
    ).first()
    if existing:
        existing.reason = body.reason
        existing.since  = datetime.now().strftime("%d/%m/%Y, %H:%M")
    else:
        db.add(models.TableMaintenance(
            table_id = table_id,
            reason   = body.reason,
            since    = datetime.now().strftime("%d/%m/%Y, %H:%M"),
        ))
    db.commit()
    return {"ok": True}

@router.delete("/maintenance/{table_id}")
def clear_maintenance(table_id: str, db: Session = Depends(get_db)):
    m = db.query(models.TableMaintenance).filter(
        models.TableMaintenance.table_id == table_id
    ).first()
    if m:
        db.delete(m)
        db.commit()
    return {"ok": True}

@router.get("/maintenance")
def get_maintenance(db: Session = Depends(get_db)):
    items = db.query(models.TableMaintenance).all()
    return {m.table_id: {"reason": m.reason, "since": m.since} for m in items}
