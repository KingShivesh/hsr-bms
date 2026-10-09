from sqlalchemy.orm import Session

import models
import json
from fastapi import HTTPException
from hsr_config import get_ist_now, TABLE_RATE_FIELDS


def tariff_catalog(settings) -> dict:
    raw = json.loads(getattr(settings, "tariffs_json", "{}") or "{}")
    return {"frame_rates": raw.get("frame_rates", {"wr": 0, "sr": 0, "pr": 0}),
            "packages": raw.get("packages", [])}


def snapshot_tariff(settings, table_id: str, mode: str, package_id: str) -> dict:
    catalog = tariff_catalog(settings)
    group = TABLE_RATE_FIELDS[table_id]
    if mode == "hourly":
        return {"tariff_mode": mode, "tariff_price": None, "tariff_label": "Hourly", "package_id": ""}
    if mode == "frame":
        price = catalog["frame_rates"].get(group, 0)
        if price <= 0:
            raise HTTPException(400, "Set a frame price for this table group in Settings first.")
        return {"tariff_mode": mode, "tariff_price": price, "tariff_label": "Per frame", "package_id": ""}
    package = next((row for row in catalog["packages"]
                    if row["id"] == package_id and row["table_group"] in {"any", group}), None)
    if not package:
        raise HTTPException(400, "Select an available package for this table group.")
    return {"tariff_mode": mode, "tariff_price": package["price"],
            "tariff_label": package["name"], "package_id": package["id"]}


def session_tariff(session, frames) -> dict:
    return {"tariff_mode": session.tariff_mode or "hourly", "tariff_price": session.tariff_price,
            "tariff_label": session.tariff_label or "", "package_id": session.package_id or "",
            "frame_count": sum(frame.status == "closed" for frame in frames)}


def get_peak_multiplier(db: Session) -> tuple[float, str]:
    hour = get_ist_now().hour
    for rule in db.query(models.PeakHourRate).all():
        if rule.start_hour <= hour < rule.end_hour:
            return rule.multiplier, rule.label
    return 1.0, "Standard"


def calc_gst(gst_percent: float, taxable: int) -> int:
    if not gst_percent or taxable <= 0:
        return 0
    return round(taxable * gst_percent / 100)


def calc_checkout(
    db: Session,
    *,
    minutes: int,
    hourly_rate: int,
    food_total: int,
    peak_multiplier: float | None = None,
    peak_label: str | None = None,
    tariff_mode: str = "hourly",
    tariff_price: int | None = None,
    tariff_label: str = "",
    package_id: str = "",
    frame_count: int = 0,
) -> dict:
    if tariff_mode == "frame":
        base_play = frame_count * (tariff_price or 0)
    elif tariff_mode == "package":
        base_play = tariff_price or 0
    else:
        base_play = round((minutes / 60) * hourly_rate)
    if tariff_mode != "hourly":
        multiplier, peak_label = 1.0, ""
    elif peak_multiplier is None:
        multiplier, peak_label = get_peak_multiplier(db)
    else:
        multiplier = peak_multiplier
        peak_label = peak_label or "Standard"
    play = round(base_play * multiplier)
    peak_surcharge = play - base_play

    subtotal = play + food_total
    taxable = subtotal

    settings = db.query(models.Settings).first()
    gst_percent = settings.gst_percent if settings and settings.gst_percent else 0
    gst_amt = calc_gst(gst_percent, taxable)
    total = taxable + gst_amt

    return {
        "tariff_mode": tariff_mode,
        "tariff_price": tariff_price,
        "tariff_label": tariff_label,
        "package_id": package_id,
        "frame_count": frame_count,
        "play": play,
        "base_play": base_play,
        "peak_surcharge": peak_surcharge,
        "peak_label": peak_label,
        "peak_multiplier": multiplier,
        "food": food_total,
        "subtotal": subtotal,
        "gst_percent": gst_percent,
        "gst_amt": gst_amt,
        "total": total,
    }
