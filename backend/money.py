"""Financial request identity and the venue's approved business-day boundary."""
from datetime import datetime, timedelta
import hashlib
import json
import re
import time

from fastapi import HTTPException
from sqlalchemy import and_, or_

import hsr_config
import models

BUSINESS_DAY_CUTOFF_HOUR = 3


def business_date(now=None):
    now = now or hsr_config.get_ist_now()
    if now.tzinfo is not None:
        now = now.astimezone(hsr_config.IST_TZ)
    return (now - timedelta(hours=BUSINESS_DAY_CUTOFF_HOUR)).strftime("%d/%m/%Y")


def business_bounds(day=None):
    try:
        start = datetime.strptime(day or business_date(), "%d/%m/%Y").replace(
            hour=BUSINESS_DAY_CUTOFF_HOUR, tzinfo=hsr_config.IST_TZ)
    except (TypeError, ValueError):
        raise HTTPException(422, "Use DD/MM/YYYY for the business date")
    return start, start + timedelta(days=1)


def record_business_date(row):
    timestamp = getattr(row, "ts", None)
    if isinstance(timestamp, (int, float)) and timestamp > 0:
        try:
            return business_date(datetime.fromtimestamp(timestamp / 1000, hsr_config.IST_TZ))
        except (ValueError, OverflowError, OSError):
            return None
    for fmt in ("%d/%m/%Y, %H:%M:%S", "%d/%m/%Y, %H:%M"):
        try:
            return business_date(datetime.strptime(row.date or "", fmt))
        except ValueError:
            pass
    return None


def day_rows(db, model, day=None):
    day = day or business_date()
    start, end = business_bounds(day)
    # Indexed epoch selection; parse only the legacy rows without usable epochs.
    legacy = and_(or_(model.ts.is_(None), model.ts <= 0), or_(
        model.date.like(start.strftime("%d/%m/%Y") + "%"),
        model.date.like(end.strftime("%d/%m/%Y") + "%")))
    rows = db.query(model).filter(or_(and_(model.ts >= start.timestamp() * 1000,
        model.ts < end.timestamp() * 1000), legacy)).all()
    return [row for row in rows if record_business_date(row) == day]


def assert_day_open(db, *, row=None, day=None):
    day = day or (record_business_date(row) if row is not None else business_date())
    if not day:
        raise HTTPException(409, "This record has no verifiable business date. Ask the owner to review it.")
    if db.query(models.DayClose).filter_by(business_date=day).first():
        raise HTTPException(409, f"Business day {day} is closed. Financial records cannot be changed.")


class MoneyRequest:
    def __init__(self, db, request, user, payload):
        key = request.headers.get("Idempotency-Key", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", key):
            raise HTTPException(428, "Refresh the app before submitting this action; a safe request ID is required.")
        self.db, self.key = db, key
        self.scope = f"{user['role']}:{user['username']}:{request.url.path.lower()}"
        data = {"query": sorted(request.query_params.multi_items()), "body": payload}
        self.fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        existing = db.get(models.MutationReceipt, (self.scope, self.key))
        self.replay = None
        if existing:
            if existing.payload_hash != self.fingerprint:
                raise HTTPException(409, "This request ID was already used for different details.")
            self.replay = {**json.loads(existing.response_json), "idempotent": True}

    def remember(self, response, *, kind="", resource_id=""):
        self.db.add(models.MutationReceipt(scope=self.scope, request_key=self.key,
            payload_hash=self.fingerprint, response_json=json.dumps(response),
            resource_kind=kind, resource_id=str(resource_id), created_at=time.time() * 1000))
        return response
