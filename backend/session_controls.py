"""Checkout proposals are previews until the existing atomic close commits."""
import json
import math

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Literal

import models
from deps import verify_password
from live_state import session_elapsed_ms, session_started_at, billable_minutes
from pricing import calc_checkout, session_tariff

REASONS = {
    "staff_forgot_to_start": ("Staff forgot to start", "correction"),
    "staff_started_too_early": ("Staff started too early", "correction"),
    "pause_not_logged": ("Pause not logged", "correction"),
    "customer_dispute": ("Customer dispute (courtesy)", "adjustment"),
    "promotional": ("Promotional / VIP", "adjustment"),
    "other": ("Other", "adjustment"),
}
DEFAULTS = {
    "halfHourAlertsEnabled": True, "halfHourAlertStartAt": 30,
    "overtimeThresholdMinutes": 180, "soundEnabled": True,
    "whatsappOnOvertime": False, "managerPhones": [],
    "allowOwnerEditTime": True, "allowStaffEditTime": True,
    "showEditWarningOnReceipt": False, "amountChangeThreshold": 500,
    "dailyEditSoftCap": 5, "lateEditWindowHours": 24,
    "upiId": "",
}

def controls(settings):
    return {**DEFAULTS, **json.loads(settings.session_controls_json or "{}")} if settings else dict(DEFAULTS)

def can_edit_time(user, settings):
    config = controls(settings)
    return (user.get("role") == "admin" and config["allowOwnerEditTime"]) or (user.get("role") == "staff" and config["allowStaffEditTime"])

class CustomerProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    member_id: str | None = None
    name: str | None = Field(default=None, max_length=80)
    recalculate_rate: bool = True

    @field_validator("name", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() or None if isinstance(value, str) else value

class TimeOverride(BaseModel):
    started_at_ms: float
    total_paused_minutes: float = Field(ge=0)
    reason: str
    notes: str = Field(default="", max_length=500)
    manager_pin: str = Field(default="", max_length=100)

    @field_validator("started_at_ms", "total_paused_minutes")
    @classmethod
    def finite(cls, value):
        if not math.isfinite(value):
            raise ValueError("Enter a finite time")
        return value

class CheckoutProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    customer: CustomerProposal | None = None
    time_override: TimeOverride | None = None
    session_key: str = Field(min_length=1)
    closed_at_ms: float | None = None
    checkout_token_value: str = ""
    payment_method: Literal["UPI", "Cash", "Credit"] = "Cash"
    payment_reference: str = Field(default="", max_length=120)
    expected_total: int | None = Field(default=None, ge=0)
    discount_type: str = "none"
    discount_value: int = 0

def resolve_customer(db, session, customer):
    if customer is None:
        return session.customer_name, session.customer_phone, session.member_id, None
    if customer.member_id:
        member = db.query(models.Member).filter(models.Member.customer_id == customer.member_id).first()
        if not member or member.record_type != "lp_member":
            raise HTTPException(404, "Loyalty member not found")
        return member.name, member.phone or None, member.customer_id, member
    return customer.name, None, None, None

def checkout_context(db, session, end_ms, settings, frames, user, proposal=None, *, enforce_pin=False):
    elapsed = session_elapsed_ms(session, end_ms)
    started = session_started_at(db, session)
    paused_ms = max(0, end_ms - started - elapsed)
    name, phone, member_id, member = resolve_customer(db, session, proposal.customer if proposal else None)
    rate = session.rate
    if proposal and proposal.customer and proposal.customer.member_id and proposal.customer.recalculate_rate and member.hourly_rate is not None and (session.tariff_mode or "hourly") == "hourly":
        rate = member.hourly_rate
    edit = proposal.time_override if proposal else None
    config = controls(settings)
    original_elapsed = elapsed
    original_started = started
    original_paused = paused_ms
    if edit:
        if not can_edit_time(user, settings):
            raise HTTPException(403, "Not permitted to edit session time")
        if edit.reason not in REASONS:
            raise HTTPException(422, "Select a valid time-edit reason")
        if edit.reason == "other" and not edit.notes.strip():
            raise HTTPException(422, "Explain the Other adjustment")
        if edit.started_at_ms <= 0 or edit.started_at_ms >= end_ms:
            raise HTTPException(422, "Start must be before the frozen end time")
        started = edit.started_at_ms
        paused_ms = edit.total_paused_minutes * 60000
        if paused_ms >= end_ms - started:
            raise HTTPException(422, "Paused duration must be less than the session duration")
        elapsed = end_ms - started - paused_ms
    hourly = (session.tariff_mode or "hourly") == "hourly"
    minimum = (settings.min_session or 0) if settings and hourly else 0
    actual_minutes = billable_minutes(elapsed, minimum)
    minutes = min(actual_minutes, 720) if hourly else actual_minutes
    def price(time_ms, hourly_rate):
        count = billable_minutes(time_ms, minimum)
        return calc_checkout(db, minutes=min(count, 720) if hourly else count, hourly_rate=hourly_rate, food_total=session.food_total, peak_multiplier=session.rate_multiplier, peak_label=session.rate_label, **session_tariff(session, frames))
    original = price(original_elapsed, session.rate)
    before_time_edit = price(original_elapsed, rate)
    checkout = price(elapsed, rate)
    delta = checkout["total"] - before_time_edit["total"]
    needs_pin = bool(edit and abs(delta) > config["amountChangeThreshold"])
    if needs_pin and enforce_pin:
        security = db.query(models.SecurityControl).first()
        if not security or not security.manager_pin_hash:
            raise HTTPException(409, "Configure a manager PIN before applying this large time adjustment")
        if not edit.manager_pin or not verify_password(edit.manager_pin, security.manager_pin_hash):
            raise HTTPException(403, "Manager PIN required for this amount change")
    metadata = None
    if edit:
        metadata = {
            "original_started_at": original_started, "new_started_at": started,
            "original_paused_ms": original_paused, "new_paused_ms": paused_ms,
            "original_duration": billable_minutes(original_elapsed, minimum), "new_duration": actual_minutes,
            "original_amount": before_time_edit["total"], "new_amount": checkout["total"],
            "delta": delta, "reason": edit.reason, "reason_label": REASONS[edit.reason][0],
            "category": REASONS[edit.reason][1], "notes": edit.notes.strip(), "staff": user["username"],
            "late_edit": (end_ms - original_started) > config["lateEditWindowHours"] * 3600000,
            "receipt_warning": config["showEditWarningOnReceipt"],
        }
    return {
        "started_at": started, "elapsed_ms": elapsed, "minutes": minutes, "actual_minutes": actual_minutes,
        "checkout": checkout, "name": name, "phone": phone, "member_id": member_id, "member": member,
        "rate": rate, "original_rate": session.rate, "original_total": original["total"],
        "rate_delta": before_time_edit["total"] - original["total"], "time_edit": metadata,
        "pin_required": needs_pin, "can_edit_time": can_edit_time(user, settings),
        "paused_minutes": paused_ms / 60000,
    }
