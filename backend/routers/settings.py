from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
from typing import Optional
import models
from audit import log_action

router = APIRouter()

class Rates(BaseModel):
    wr: int
    pr: int
    sr: int

class MenuItemBody(BaseModel):
    name:     str
    price:    int
    category: str = "Snacks"

class RenameItem(BaseModel):
    old_name: str
    new_name: str
    price:    int
    category: str = "Snacks"

class AvailabilityBody(BaseModel):
    available: bool

class MinSessionBody(BaseModel):
    min_session: int

class BookingGraceBody(BaseModel):
    booking_grace_minutes: int

@router.get("/rates")
def get_rates(db: Session = Depends(get_db)):
    s = db.query(models.Settings).first()
    return {"wr": getattr(s, "wr", 320), "pr": s.pr, "sr": s.sr}

@router.post("/rates")
def save_rates(body: Rates, db: Session = Depends(get_db)):
    s = db.query(models.Settings).first()
    s.wr = body.wr
    s.pr = body.pr
    s.sr = body.sr
    db.commit()
    return {"ok": True}

@router.get("/min-session")
def get_min_session(db: Session = Depends(get_db)):
    s = db.query(models.Settings).first()
    return {"min_session": s.min_session if s and hasattr(s, 'min_session') else 0}

@router.post("/min-session")
def save_min_session(body: MinSessionBody, db: Session = Depends(get_db)):
    s = db.query(models.Settings).first()
    s.min_session = body.min_session
    db.commit()
    return {"ok": True}

@router.get("/booking-grace")
def get_booking_grace(db: Session = Depends(get_db)):
    s = db.query(models.Settings).first()
    return {"booking_grace_minutes": getattr(s, "booking_grace_minutes", 10) or 10}

@router.post("/booking-grace")
def save_booking_grace(body: BookingGraceBody, db: Session = Depends(get_db)):
    s = db.query(models.Settings).first()
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
def add_menu_item(body: MenuItemBody, db: Session = Depends(get_db)):
    existing = db.query(models.MenuItem).filter(models.MenuItem.name == body.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Item already exists")
    db.add(models.MenuItem(name=body.name, price=body.price, category=body.category, available=True))
    db.commit()
    return {"ok": True}

@router.post("/menu/update")
def update_menu_item(body: RenameItem, db: Session = Depends(get_db)):
    item = db.query(models.MenuItem).filter(models.MenuItem.name == body.old_name).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.name     = body.new_name
    item.price    = body.price
    item.category = body.category
    db.commit()
    return {"ok": True}

@router.post("/menu/{item_name}/availability")
def set_availability(item_name: str, body: AvailabilityBody, db: Session = Depends(get_db)):
    item = db.query(models.MenuItem).filter(models.MenuItem.name == item_name).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    item.available = body.available
    db.commit()
    return {"ok": True}

@router.delete("/menu/{item_name}")
def delete_menu_item(item_name: str, db: Session = Depends(get_db)):
    item = db.query(models.MenuItem).filter(models.MenuItem.name == item_name).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}

@router.post("/reset-daily")
def reset_daily(manager_pin: str = "", db: Session = Depends(get_db)):
    today = __import__('datetime').datetime.now().strftime("%d/%m/%Y")
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
def clear_all(manager_pin: str = "", db: Session = Depends(get_db)):
    tx_count = db.query(models.Transaction).count()
    db.query(models.Transaction).delete()
    db.query(models.ActiveSession).delete()
    db.query(models.Member).delete()
    db.query(models.FoodOnlyOrder).delete()
    s = db.query(models.Settings).first()
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
