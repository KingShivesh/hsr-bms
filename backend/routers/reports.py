from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from database import get_db
from deps import require_admin
from datetime import datetime, timedelta
from collections import defaultdict
import models, io, json
from audit import get_controls
from hsr_config import CSV_PREFIX, POOL_TABLES, SNOOKER_TABLES, TABLE_LABELS, TABLE_RATES

router = APIRouter()
MAX_REPORT_DURATION_MINUTES = 12 * 60
REPORT_TABLES = [table_id.upper() for table_id in TABLE_RATES]

# ── helpers ──
def parse_date(t: models.Transaction):
    try:    return datetime.strptime(t.date, "%d/%m/%Y, %H:%M:%S")
    except: return None

def valid_duration(duration: int | None) -> bool:
    return isinstance(duration, int) and 0 < duration <= MAX_REPORT_DURATION_MINUTES

def valid_report_transaction(t: models.Transaction) -> bool:
    if not valid_duration(t.duration):
        return False
    if not (t.customer_name or "").strip() and (t.total or 0) <= 0:
        return False
    return True

def report_transactions(db: Session):
    return [
        t for t in db.query(models.Transaction).all()
        if valid_report_transaction(t)
    ]

def filter_transactions(transactions, period: str):
    now = datetime.now()
    if period == "today":
        today = now.strftime("%d/%m/%Y")
        return [t for t in transactions if t.date.startswith(today)]
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

# ── Summary ──
@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    today        = datetime.now().strftime("%d/%m/%Y")
    transactions = [
        t for t in report_transactions(db)
        if t.date and t.date.startswith(today)
    ]
    active = db.query(models.ActiveSession).filter(
        models.ActiveSession.customer_name != ""
    ).count()

    total_sale = sum(t.total    for t in transactions)
    total_food = sum(t.food_charge for t in transactions)
    total_cust = len(transactions)
    avg_time   = 0
    top_table  = "-"

    if transactions:
        avg_time = round(sum(t.duration for t in transactions) / len(transactions))
        table_counts = {}
        for t in transactions:
            table_counts[t.table_id] = table_counts.get(t.table_id, 0) + 1
        top_table = max(table_counts, key=table_counts.get)

    return {
        "sale": total_sale, "cust": total_cust, "food": total_food,
        "sessions": len(transactions), "avg_time": avg_time,
        "top_table": top_table, "active_tables": active
    }

# ── History ──
@router.get("/history")
def get_history(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    txns = sorted(report_transactions(db), key=lambda t: t.ts or 0, reverse=True)
    return [
        { "date": t.date, "ts": t.ts, "tbl": t.table_id, "nm": t.customer_name,
          "dur": t.duration, "ply": t.play_charge, "famt": t.food_charge,
          "food": t.food_items, "tot": t.total,
          "billing_mode": getattr(t, "billing_mode", "single") or "single",
          "payer_name": getattr(t, "payer_name", "") or "",
          "split_names": t.split_names or "" }
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

    output = io.StringIO()
    output.write("Date,Table,Customer,Billing Mode,Payer,Duration,Play,Food,Total,Notes\n")
    for t in transactions:
        notes = (t.notes or "").replace('"', '""')
        mode = getattr(t, "billing_mode", "single") or "single"
        payer = (getattr(t, "payer_name", "") or "").replace('"', '""')
        output.write(f'"{t.date}",{t.table_id},{t.customer_name},{mode},"{payer}",{t.duration},{t.play_charge},{t.food_charge},{t.total},"{notes}"\n')
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

    now = datetime.now()
    if period == "month":
        txns = [t for t in all_txns
                if len(t.date) >= 10
                and t.date[3:5] == now.strftime("%m")
                and t.date[6:10] == now.strftime("%Y")]
        label = now.strftime("%B %Y")
    elif period == "week":
        week_ago = now - timedelta(days=7)
        txns  = [t for t in all_txns if (lambda d: d and d >= week_ago)(parse_date(t))]
        label = "Last 7 days"
    else:
        txns  = all_txns
        label = "All time"

    customer_stats = defaultdict(lambda: {"visits": 0, "spent": 0, "play": 0, "food": 0})
    for t in txns:
        nm = t.customer_name
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
@router.get("/closing-report")
def closing_report(db: Session = Depends(get_db)):
    today = datetime.now().strftime("%d/%m/%Y")
    txns  = [
        t for t in report_transactions(db)
        if t.date and t.date.startswith(today)
    ]

    total_revenue  = sum(t.total       for t in txns)
    play_revenue   = sum(t.play_charge for t in txns)
    food_revenue   = sum(t.food_charge for t in txns)
    total_sessions = len(txns)
    avg_duration   = round(sum(t.duration for t in txns) / total_sessions) if total_sessions else 0
    payment_breakdown = {"Cash": 0, "UPI": 0, "Card": 0}
    for t in txns:
        method = t.payment_method if t.payment_method in payment_breakdown else "Cash"
        payment_breakdown[method] += t.total

    food_only_orders = [
        o for o in db.query(models.FoodOnlyOrder).all()
        if o.date and o.date.startswith(today)
    ]
    food_only_revenue = sum(o.total for o in food_only_orders)
    food_only_payment_breakdown = {"Cash": 0, "UPI": 0, "Card": 0}
    for o in food_only_orders:
        method = o.payment_method if o.payment_method in food_only_payment_breakdown else "Cash"
        food_only_payment_breakdown[method] += o.total or 0
        payment_breakdown[method] += o.total or 0
    corrections_today = db.query(models.AuditLog).filter(
        models.AuditLog.date.like(f"{today}%"),
        models.AuditLog.action.in_(["session_reset", "daily_reset", "clear_all"]),
    ).order_by(models.AuditLog.ts.desc()).all()
    active_sessions = db.query(models.ActiveSession).filter(
        models.ActiveSession.customer_name != ""
    ).all()
    active_table_ids = {s.table_id.lower() for s in active_sessions}
    open_tables = [
        {
            "table_id": s.table_id.upper(),
            "customer_name": s.customer_name,
            "food_total": s.food_total or 0,
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
        table_breakdown[t.table_id]["revenue"]  += t.total

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
        "total_revenue":  total_revenue,
        "play_revenue":   play_revenue,
        "food_revenue":   food_revenue,
        "food_only_revenue": food_only_revenue,
        "food_only_payment_breakdown": food_only_payment_breakdown,
        "cash_total": payment_breakdown["Cash"],
        "upi_total": payment_breakdown["UPI"],
        "card_total": payment_breakdown["Card"],
        "payment_breakdown": payment_breakdown,
        "total_sessions": total_sessions,
        "avg_duration":   avg_duration,
        "active_tables": len(open_tables),
        "open_tables": open_tables,
        "idle_tables": idle_tables,
        "can_close_day": len(open_tables) == 0,
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
        "transactions":   [
            { "tbl": t.table_id, "nm": t.customer_name, "dur": t.duration,
              "ply": t.play_charge, "famt": t.food_charge, "tot": t.total,
              "payment_method": t.payment_method or "Cash" }
            for t in txns
        ]
    }

@router.get("/closing-insights")
def closing_insights(db: Session = Depends(get_db)):
    today = datetime.now().strftime("%d/%m/%Y")
    now_ms = datetime.now().timestamp() * 1000
    controls = get_controls(db)

    all_txns = report_transactions(db)
    today_txns = [t for t in all_txns if t.date and t.date.startswith(today)]
    prior_txns = []
    week_ago = datetime.now() - timedelta(days=7)
    for t in all_txns:
        dt = parse_date(t)
        if dt and dt.date() != datetime.now().date() and dt >= week_ago:
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

    resets_today = db.query(models.AuditLog).filter(
        models.AuditLog.date.like(f"{today}%"),
        models.AuditLog.action.in_(["session_reset", "daily_reset", "clear_all"]),
    ).all()
    if resets_today:
        insights.append({
            "type": "critical",
            "title": "Sensitive actions happened today",
            "detail": f"{len(resets_today)} reset/clear action(s) were logged. Review the audit log before closing.",
        })

    active_sessions = db.query(models.ActiveSession).filter(
        models.ActiveSession.customer_name != ""
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
    transactions = report_transactions(db)

    # Weekly revenue
    weekly = {}
    for i in range(6, -1, -1):
        d   = datetime.now() - timedelta(days=i)
        key = d.strftime("%d/%m")
        weekly[key] = 0
    for t in transactions:
        try:
            dt  = datetime.strptime(t.date, "%d/%m/%Y, %H:%M:%S")
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
    now      = datetime.now()
    last_m   = (now.replace(day=1) - timedelta(days=1))
    this_total = sum(t.total for t in transactions
        if len(t.date) >= 10
        and t.date[3:5] == now.strftime("%m")
        and t.date[6:10] == now.strftime("%Y"))
    last_total = sum(t.total for t in transactions
        if len(t.date) >= 10
        and t.date[3:5] == last_m.strftime("%m")
        and t.date[6:10] == last_m.strftime("%Y"))

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
      customer_visits[t.customer_name] += 1
      customer_spend[t.customer_name] += t.total
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
