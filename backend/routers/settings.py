from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from database import get_db
from typing import Optional
import models
from audit import log_action, require_manager_pin
from deps import require_admin
from hsr_config import get_ist_today_str

router = APIRouter()


def get_or_create_settings(db: Session) -> models.Settings:
    settings = db.query(models.Settings).first()
    if settings:
        return settings
    settings = models.Settings()
    db.add(settings)
    db.flush()
    return settings

class Rates(BaseModel):
    wr: int = Field(ge=1, le=5000)
    pr: int = Field(ge=1, le=5000)
    sr: int = Field(ge=1, le=5000)

class MenuItemBody(BaseModel):
    name:     str = Field(min_length=1, max_length=80)
    price:    int = Field(ge=0, le=100000)
    category: str = Field(default="Snacks", max_length=50)

class RestoreMenuItemBody(MenuItemBody):
    available: bool = True

class RenameItem(BaseModel):
    old_name: str = Field(min_length=1, max_length=80)
    new_name: str = Field(min_length=1, max_length=80)
    price:    int = Field(ge=0, le=100000)
    category: str = Field(default="Snacks", max_length=50)

class AvailabilityBody(BaseModel):
    available: bool

class MinSessionBody(BaseModel):
    min_session: int = Field(ge=0, le=240)

class BookingGraceBody(BaseModel):
    booking_grace_minutes: int = Field(ge=1, le=120)

@router.get("/rates")
def get_rates(db: Session = Depends(get_db)):
    s = get_or_create_settings(db)
    return {"wr": getattr(s, "wr", 320), "pr": s.pr, "sr": s.sr}

@router.post("/rates")
def save_rates(
    body: Rates,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    s = get_or_create_settings(db)
    s.wr = body.wr
    s.pr = body.pr
    s.sr = body.sr
    db.commit()
    return {"ok": True}

@router.get("/min-session")
def get_min_session(db: Session = Depends(get_db)):
    s = get_or_create_settings(db)
    return {"min_session": s.min_session if s and hasattr(s, 'min_session') else 0}

@router.post("/min-session")
def save_min_session(
    body: MinSessionBody,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    s = get_or_create_settings(db)
    s.min_session = body.min_session
    db.commit()
    return {"ok": True}

@router.get("/booking-grace")
def get_booking_grace(db: Session = Depends(get_db)):
    s = get_or_create_settings(db)
    return {"booking_grace_minutes": getattr(s, "booking_grace_minutes", 10) or 10}

@router.post("/booking-grace")
def save_booking_grace(
    body: BookingGraceBody,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    s = get_or_create_settings(db)
    s.booking_grace_minutes = max(1, min(body.booking_grace_minutes, 120))
    db.commit()
    return {"ok": True}

@router.get("/menu")
def get_menu(db: Session = Depends(get_db)):
    items = db.query(models.MenuItem).all()
    # Return as dict for backward compat + full objects for new features
    return {
        item.name: {
            "price":     item.price,
            "category":  item.category or "Snacks",
            "available": item.available if item.available is not None else True,
        }
        for item in items
    }

@router.post("/menu")
def add_menu_item(
    body: MenuItemBody,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    name = " ".join(body.name.strip().split())
    category = " ".join((body.category or "Snacks").strip().split()) or "Snacks"
    existing = db.query(models.MenuItem).filter(models.MenuItem.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Item already exists")
    db.add(models.MenuItem(name=name, price=body.price, category=category, available=True))
    db.commit()
    return {"ok": True}

@router.post("/menu/update")
def update_menu_item(
    body: RenameItem,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    item = db.query(models.MenuItem).filter(models.MenuItem.name == body.old_name).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.name     = " ".join(body.new_name.strip().split())
    item.price    = body.price
    item.category = " ".join((body.category or "Snacks").strip().split()) or "Snacks"
    db.commit()
    return {"ok": True}

@router.post("/menu/restore")
def restore_menu_item(
    body: RestoreMenuItemBody,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    name = " ".join(body.name.strip().split())
    category = " ".join((body.category or "Snacks").strip().split()) or "Snacks"
    existing = db.query(models.MenuItem).filter(models.MenuItem.name == name).first()
    if existing:
        existing.price = body.price
        existing.category = category
        existing.available = body.available
    else:
        db.add(models.MenuItem(
            name=name,
            price=body.price,
            category=category,
            available=body.available,
        ))
    db.commit()
    return {"ok": True}

@router.post("/menu/{item_name}/availability")
def set_availability(
    item_name: str,
    body: AvailabilityBody,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    item = db.query(models.MenuItem).filter(models.MenuItem.name == item_name).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.available = body.available
    db.commit()
    return {"ok": True}

@router.delete("/menu/{item_name}")
def delete_menu_item(
    item_name: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    item = db.query(models.MenuItem).filter(models.MenuItem.name == item_name).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}

@router.post("/reset-daily")
def reset_daily(
    manager_pin: str = "",
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    require_manager_pin(db, manager_pin)
    today = get_ist_today_str()
    deleted = db.query(models.Transaction).filter(
        models.Transaction.date.like(f"{today}%")
    ).delete(synchronize_session=False)
    log_action(
        db,
        "daily_reset",
        f"Deleted {deleted} transactions for {today}",
        severity="critical",
        amount=deleted,
    )
    db.commit()
    return {"ok": True}

@router.post("/clear-all")
def clear_all(
    manager_pin: str = "",
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    require_manager_pin(db, manager_pin)
    tx_count = db.query(models.Transaction).count()
    db.query(models.Transaction).delete()
    db.query(models.ActiveSession).delete()
    db.query(models.Member).delete()
    db.query(models.FoodOnlyOrder).delete()
    s = get_or_create_settings(db)
    s.pr = 170
    s.sr = 270
    log_action(
        db,
        "clear_all",
        "All operational data was cleared",
        severity="critical",
        amount=tx_count,
    )
    db.commit()
    return {"ok": True}
