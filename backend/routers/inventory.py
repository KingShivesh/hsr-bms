from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from audit import log_action
from database import get_db
from hsr_config import get_ist_now
import models

router = APIRouter()


class InventoryBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str = Field(default="Supplies", max_length=80)
    quantity: int = Field(default=0, ge=0)
    unit: str = Field(default="pcs", max_length=40)
    min_alert_threshold: int = Field(default=0, ge=0)
    supplier: str = Field(default="", max_length=160)
    unit_cost: int = Field(default=0, ge=0)
    notes: str = ""


class StockAdjustBody(BaseModel):
    delta: int
    reason: str = ""


DEFAULT_INVENTORY = [
    {
        "name": "Cue Chalk",
        "category": "Equipment",
        "quantity": 12,
        "unit": "boxes",
        "min_alert_threshold": 4,
        "supplier": "Local sports supplier",
        "unit_cost": 120,
    },
    {
        "name": "Cue Tips",
        "category": "Maintenance",
        "quantity": 20,
        "unit": "pcs",
        "min_alert_threshold": 6,
        "supplier": "Cue repair vendor",
        "unit_cost": 35,
    },
    {
        "name": "Table Cloth Brush",
        "category": "Maintenance",
        "quantity": 3,
        "unit": "pcs",
        "min_alert_threshold": 1,
        "supplier": "Cleaning supplies",
        "unit_cost": 250,
    },
    {
        "name": "Cold Drink Stock",
        "category": "Beverages",
        "quantity": 24,
        "unit": "bottles",
        "min_alert_threshold": 8,
        "supplier": "Beverage distributor",
        "unit_cost": 25,
    },
]


def clean_text(value: str) -> str:
    return " ".join((value or "").strip().split())


def inventory_status(item: models.InventoryItem) -> str:
    if (item.quantity or 0) <= 0:
        return "Out of Stock"
    if (item.quantity or 0) <= (item.min_alert_threshold or 0):
        return "Low Stock"
    return "In Stock"


def serialize_item(item: models.InventoryItem) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "category": item.category or "Supplies",
        "quantity": item.quantity or 0,
        "unit": item.unit or "pcs",
        "min_alert_threshold": item.min_alert_threshold or 0,
        "supplier": item.supplier or "",
        "unit_cost": item.unit_cost or 0,
        "stock_value": (item.quantity or 0) * (item.unit_cost or 0),
        "last_restocked": item.last_restocked or "",
        "notes": item.notes or "",
        "status": inventory_status(item),
    }


def ensure_default_inventory(db: Session) -> None:
    if db.query(models.InventoryItem).count() > 0:
        return
    now = get_ist_now().strftime("%d/%m/%Y, %H:%M")
    for row in DEFAULT_INVENTORY:
        db.add(models.InventoryItem(**row, last_restocked=now))
    db.commit()


@router.get("/")
def list_inventory(db: Session = Depends(get_db)):
    ensure_default_inventory(db)
    rows = db.query(models.InventoryItem).order_by(
        models.InventoryItem.category.asc(),
        models.InventoryItem.name.asc(),
    ).all()
    return [serialize_item(row) for row in rows]


@router.get("/summary")
def inventory_summary(db: Session = Depends(get_db)):
    ensure_default_inventory(db)
    rows = db.query(models.InventoryItem).all()
    low = [row for row in rows if inventory_status(row) != "In Stock"]
    return {
        "total_items": len(rows),
        "low_stock": len(low),
        "stock_value": sum((row.quantity or 0) * (row.unit_cost or 0) for row in rows),
        "alerts": [serialize_item(row) for row in low],
    }


@router.post("/")
def add_inventory_item(body: InventoryBody, db: Session = Depends(get_db)):
    name = clean_text(body.name)
    if not name:
        raise HTTPException(status_code=400, detail="Inventory item name is required")
    exists = db.query(models.InventoryItem).filter(models.InventoryItem.name.ilike(name)).first()
    if exists:
        raise HTTPException(status_code=400, detail="Inventory item already exists")
    item = models.InventoryItem(
        name=name,
        category=clean_text(body.category) or "Supplies",
        quantity=body.quantity,
        unit=clean_text(body.unit) or "pcs",
        min_alert_threshold=body.min_alert_threshold,
        supplier=clean_text(body.supplier),
        unit_cost=body.unit_cost,
        last_restocked=get_ist_now().strftime("%d/%m/%Y, %H:%M"),
        notes=(body.notes or "").strip(),
    )
    db.add(item)
    log_action(db, "inventory_add", f"Added stock item {name}", amount=body.quantity)
    db.commit()
    db.refresh(item)
    return serialize_item(item)


@router.put("/{item_id}")
def update_inventory_item(item_id: int, body: InventoryBody, db: Session = Depends(get_db)):
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    item.name = clean_text(body.name)
    item.category = clean_text(body.category) or "Supplies"
    item.quantity = body.quantity
    item.unit = clean_text(body.unit) or "pcs"
    item.min_alert_threshold = body.min_alert_threshold
    item.supplier = clean_text(body.supplier)
    item.unit_cost = body.unit_cost
    item.notes = (body.notes or "").strip()
    if body.quantity > 0:
        item.last_restocked = item.last_restocked or get_ist_now().strftime("%d/%m/%Y, %H:%M")
    log_action(db, "inventory_update", f"Updated stock item {item.name}", amount=item.quantity)
    db.commit()
    db.refresh(item)
    return serialize_item(item)


@router.post("/{item_id}/adjust")
def adjust_inventory_stock(item_id: int, body: StockAdjustBody, db: Session = Depends(get_db)):
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    next_quantity = max(0, (item.quantity or 0) + int(body.delta or 0))
    item.quantity = next_quantity
    if body.delta > 0:
        item.last_restocked = get_ist_now().strftime("%d/%m/%Y, %H:%M")
    detail = f"{item.name} adjusted by {body.delta}"
    if body.reason.strip():
        detail += f" ({body.reason.strip()})"
    log_action(db, "inventory_adjust", detail, amount=body.delta)
    db.commit()
    db.refresh(item)
    return serialize_item(item)


@router.delete("/{item_id}")
def delete_inventory_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    log_action(db, "inventory_delete", f"Deleted stock item {item.name}", amount=item.quantity or 0)
    db.delete(item)
    db.commit()
    return {"ok": True}
