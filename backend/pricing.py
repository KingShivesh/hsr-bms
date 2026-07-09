from datetime import datetime

from sqlalchemy.orm import Session

import models


def get_peak_multiplier(db: Session) -> tuple[float, str]:
    hour = datetime.now().hour
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
) -> dict:
    base_play = round((minutes / 60) * hourly_rate)
    multiplier, peak_label = get_peak_multiplier(db)
    play = round(base_play * multiplier)
    peak_surcharge = play - base_play

    subtotal = play + food_total
    taxable = subtotal

    settings = db.query(models.Settings).first()
    gst_percent = settings.gst_percent if settings and settings.gst_percent else 0
    gst_amt = calc_gst(gst_percent, taxable)
    total = taxable + gst_amt

    return {
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
