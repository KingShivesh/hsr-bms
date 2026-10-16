"""Truthful product context for the existing single-club deployment."""
import base64
import binascii
import json
import struct
import zlib

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from audit import log_action
from database import get_db, get_mutation_db
from deps import require_admin
from hsr_config import APP_NAME, TABLES
from session_controls import controls

router = APIRouter()
DEFAULT_PROFILE = {"name": APP_NAME, "logo": "", "address": "", "phone": "", "gst": ""}
DEFAULT_SETUP = {"dismissed": False, "collapsed": False, "rates_reviewed": False, "guide_reviewed": False}


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    version: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=80)
    logo: str = Field(default="", max_length=180000)
    address: str = Field(default="", max_length=300)
    phone: str = Field(default="", max_length=30, pattern=r"^[0-9+()\s-]*$")
    gst: str = Field(default="", max_length=15, pattern=r"^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
    upiId: str = Field(default="", max_length=120, pattern=r"^$|^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$")
    previousUpiId: str = Field(default="", max_length=120)

    @field_validator("logo")
    @classmethod
    def safe_logo(cls, value):
        if not value:
            return value
        prefix = "data:image/png;base64,"
        if not value.startswith(prefix):
            raise ValueError("Use a PNG logo, not an SVG or external URL")
        try:
            raw = base64.b64decode(value[len(prefix):], validate=True)
            if len(raw) > 131072 or raw[:8] != b"\x89PNG\r\n\x1a\n":
                raise ValueError("PNG logo must be at most 128 KB")
            offset, dimensions, ended, image_data = 8, None, False, False
            while offset < len(raw):
                length = struct.unpack(">I", raw[offset:offset + 4])[0]
                kind = raw[offset + 4:offset + 8]
                data = raw[offset + 8:offset + 8 + length]
                checksum = struct.unpack(">I", raw[offset + 8 + length:offset + 12 + length])[0]
                if zlib.crc32(kind + data) & 0xffffffff != checksum:
                    raise ValueError("Invalid PNG checksum")
                if offset == 8:
                    if kind != b"IHDR" or length != 13:
                        raise ValueError("Invalid PNG header")
                    dimensions = struct.unpack(">II", data[:8])
                if kind == b"IEND":
                    ended = length == 0 and offset + 12 == len(raw)
                    break
                if kind == b"IDAT" and length:
                    image_data = True
                offset += 12 + length
            if not ended or not image_data or not dimensions or not all(0 < n <= 512 for n in dimensions):
                raise ValueError("Use a complete PNG no larger than 512 by 512")
        except (binascii.Error, struct.error, IndexError) as exc:
            raise ValueError("Invalid PNG logo") from exc
        return value


class SetupInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dismissed: bool | None = None
    collapsed: bool | None = None
    rates_reviewed: bool | None = None
    guide_reviewed: bool | None = None
    team_reviewed: bool | None = None


def snapshot(db):
    row = db.get(models.ClubProfile, 1)
    settings = db.query(models.Settings).first()
    return {"profile": {**DEFAULT_PROFILE, **json.loads(row.profile_json if row else "{}"),
                        "upiId": controls(settings)["upiId"]},
            "version": row.version if row else 0,
            "setup": {**DEFAULT_SETUP, **json.loads(row.setup_json if row else "{}")}}


@router.get("/context")
def context(db: Session = Depends(get_db)):
    data = snapshot(db)
    return {"profile": data["profile"], "version": data["version"], "deployment": "single_club"}


@router.put("/profile")
def save_profile(body: ProfileInput, db: Session = Depends(get_mutation_db), user: dict = Depends(require_admin)):
    row = db.query(models.ClubProfile).filter_by(id=1).with_for_update().first()
    if body.version != (row.version if row else 0):
        raise HTTPException(409, "Club profile changed elsewhere. Reload before saving.")
    if not row:
        row = models.ClubProfile(id=1, version=0, profile_json="{}", setup_json="{}")
        db.add(row)
    row.version += 1
    row.profile_json = json.dumps(body.model_dump(exclude={"version", "upiId", "previousUpiId"}))
    settings = db.query(models.Settings).with_for_update().first()
    if not settings:
        raise HTTPException(409, "Configure your account before saving the club profile")
    if controls(settings)["upiId"] != body.previousUpiId:
        raise HTTPException(409, "Payment settings changed elsewhere. Reload before saving.")
    settings.session_controls_json = json.dumps({**controls(settings), "upiId": body.upiId})
    log_action(db, "club_profile_updated", "Club identity and payment configuration updated", staff=user["username"])
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Club profile changed elsewhere. Reload before saving.") from exc
    return context(db)


@router.get("/account")
def account(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    settings = db.query(models.Settings).first()
    return {"deployment": "Single club", "subscription": None, "quotas": None,
            "members": db.query(models.Member).count(), "tables": len(TABLES),
            "team": [{"username": settings.username, "role": "Owner"},
                     *([{"username": settings.staff_username, "role": "Staff"}] if settings.staff_username else [])] if settings else [],
            "individual_accounts": False, "invitations": False}


@router.get("/setup")
def setup(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    data = snapshot(db)
    profile, prefs = data["profile"], data["setup"]
    settings = db.query(models.Settings).first()
    menu_count = db.query(models.MenuItem).count()
    data["steps"] = [
        {"id": "profile", "label": "Add club identity", "done": bool(profile["address"] and profile["phone"]), "section": "club"},
        {"id": "rates", "label": f"Review {len(TABLES)} table rates", "done": prefs["rates_reviewed"], "section": "operations"},
        {"id": "team", "label": "Review staff access", "done": bool(settings and settings.staff_username and prefs.get("team_reviewed")), "section": "team"},
        {"id": "menu", "label": "Add cafe menu items", "done": menu_count > 0, "page": "inventory"},
        {"id": "payment", "label": "Configure UPI payments", "done": bool(profile["upiId"]), "section": "club"},
        {"id": "guide", "label": "Review your first shift", "done": prefs["guide_reviewed"], "page": "help"},
    ]
    return data


@router.patch("/setup")
def save_setup(body: SetupInput, db: Session = Depends(get_mutation_db), user: dict = Depends(require_admin)):
    row = db.query(models.ClubProfile).filter_by(id=1).with_for_update().first()
    if not row:
        row = models.ClubProfile(id=1, version=0, profile_json="{}", setup_json="{}")
        db.add(row)
    row.setup_json = json.dumps({**DEFAULT_SETUP, **json.loads(row.setup_json or "{}"), **body.model_dump(exclude_none=True)})
    log_action(db, "setup_preferences_updated", "Setup checklist preferences updated", staff=user["username"])
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Setup changed elsewhere. Try again.") from exc
    return setup(db, user)
