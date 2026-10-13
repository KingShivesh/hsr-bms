"""Durable threshold alerts; the single-worker task emits REST invalidations."""
import asyncio
import logging
import time
import json
from datetime import datetime, timedelta
from collections import Counter

from sqlalchemy import text

import models
from database import SessionLocal, engine
from live_state import session_elapsed_ms
from session_identity import is_active_session
from session_controls import controls
from realtime import event_broker
from hsr_config import IST_TZ

logger = logging.getLogger(__name__)

def collect_weekly_summary(db, now_ms):
    local = datetime.fromtimestamp(now_ms / 1000, IST_TZ)
    monday = (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    key = monday.date().isoformat()
    if db.get(models.SessionWeeklySummary, key):
        return 0
    start, end = (monday - timedelta(days=7)).timestamp() * 1000, monday.timestamp() * 1000
    events = db.query(models.SessionEvent).filter(models.SessionEvent.event_type == "session_time_edited", models.SessionEvent.ts >= start, models.SessionEvent.ts < end).all()
    total = db.query(models.Transaction).filter(models.Transaction.ts >= start, models.Transaction.ts < end).count()
    edits = [json.loads(event.payload_json) for event in events]
    reasons = Counter(edit["reason_label"] for edit in edits)
    payload = {"week_start": key, "count": len(edits), "percentage": round(len(edits) / total * 100, 1) if total else 0,
        "delta": sum(edit["delta"] for edit in edits), "top_reason": reasons.most_common(1)[0][0] if reasons else "None"}
    db.add(models.SessionWeeklySummary(week_start=key, payload_json=json.dumps(payload)))
    return 1

def collect_alerts(now_ms=None):
    now_ms = now_ms if now_ms is not None else time.time() * 1000
    inserted = 0
    with SessionLocal() as db:
        if engine.dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": 48535201})
        else:
            db.execute(text("BEGIN IMMEDIATE"))
        config = controls(db.query(models.Settings).first())
        inserted += collect_weekly_summary(db, now_ms)
        for session in db.query(models.ActiveSession).all():
            if not config["halfHourAlertsEnabled"] or not is_active_session(session) or session.paused or not session.session_key:
                continue
            # A billing minimum or rounding up must not fire a time reminder early.
            minutes = int(session_elapsed_ms(session, now_ms) // 60000)
            thresholds = set(range(config["halfHourAlertStartAt"], minutes + 1, 30))
            overtime = config["overtimeThresholdMinutes"]
            if minutes >= overtime:
                thresholds.add(overtime)
            for threshold in sorted(thresholds):
                alert_type = "overtime" if threshold == overtime else f"check_in_{threshold}"
                result = db.execute(text(
                    "INSERT INTO session_alerts (session_key, table_id, alert_type, threshold_minutes, intensity, fired_at) "
                    "VALUES (:key, :table, :type, :threshold, :intensity, :now) "
                    "ON CONFLICT (session_key, alert_type, threshold_minutes) DO NOTHING"
                ), {"key": session.session_key, "table": session.table_id, "type": alert_type, "threshold": threshold,
                    "intensity": "urgent" if threshold == overtime else "subtle" if threshold == 30 else "normal", "now": now_ms})
                inserted += max(0, result.rowcount)
        db.commit()
    return inserted

async def alert_loop():
    while True:
        try:
            if await asyncio.to_thread(collect_alerts):
                await event_broker.publish("session.alert", "floor", ("session-alerts", "live-floor"))
        except Exception:
            logger.exception("Session alert scan failed; retrying next minute")
        await asyncio.sleep(60)
