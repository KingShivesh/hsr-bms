from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from database import get_db
from typing import List
import models, json, time
from collections import Counter, defaultdict
from hsr_config import format_ist_now

router = APIRouter()
PAYMENT_METHODS = {"Cash", "UPI", "Card"}

class FoodOrderItem(BaseModel):
    item: str = Field(min_length=1, max_length=80)
    qty:  int = Field(ge=1, le=100)
    mrp:  int | None = Field(default=None, ge=1, le=100000)

class FoodOnlyOrderBody(BaseModel):
    customer_name: str = Field(default="", max_length=80)
    items:         List[FoodOrderItem]
    payment_method: str = "Cash"

def is_cigarette_item(name: str) -> bool:
    return "cigarette" in (name or "").lower() or "cigg" in (name or "").lower()

@router.post("/order")
def place_food_order(body: FoodOnlyOrderBody, db: Session = Depends(get_db)):
    if not body.items:
        raise HTTPException(status_code=400, detail="No items in order")
    payment_method = body.payment_method if body.payment_method in PAYMENT_METHODS else "Cash"

    total    = 0
    order    = []
    for fi in body.items:
        menu_item = db.query(models.MenuItem).filter(models.MenuItem.name == fi.item).first()
        if not menu_item:
            raise HTTPException(status_code=404, detail=f"{fi.item} not found")
        if not menu_item.available:
            raise HTTPException(status_code=400, detail=f"{fi.item} is currently unavailable")
        item_name = fi.item
        if is_cigarette_item(fi.item):
            if not fi.mrp or fi.mrp <= 0:
                raise HTTPException(status_code=400, detail="Enter cigarette price")
            unit_price = fi.mrp + 3
            item_name = f"{fi.item} (MRP ₹{fi.mrp} + ₹3)"
        else:
            unit_price = menu_item.price
        price = unit_price * fi.qty
        total += price
        order.append({"item": item_name, "qty": fi.qty, "price": price})

    db.add(models.FoodOnlyOrder(
        date          = format_ist_now(),
        ts            = time.time() * 1000,
        customer_name = body.customer_name,
        items         = json.dumps(order),
        total         = total,
        payment_method = payment_method,
    ))
    db.commit()
    return {"ok": True, "total": total, "items": order, "payment_method": payment_method}

@router.get("/orders")
def get_food_orders(db: Session = Depends(get_db)):
    orders = db.query(models.FoodOnlyOrder).order_by(models.FoodOnlyOrder.ts.desc()).all()
    return [
        {
            "id":            o.id,
            "date":          o.date,
            "customer_name": o.customer_name,
            "items":         json.loads(o.items),
            "total":         o.total,
            "payment_method": o.payment_method or "Cash",
        }
        for o in orders
    ]

@router.delete("/orders/{order_id}")
def cancel_food_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(models.FoodOnlyOrder).filter(models.FoodOnlyOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Food order not found")
    db.delete(order)
    db.commit()
    return {"ok": True}

@router.get("/stats")
def get_food_stats(db: Session = Depends(get_db)):
    # Count item sales from both session transactions and food-only orders
    counter = Counter()
    revenue_counter = defaultdict(int)

    # From session transactions
    txns = db.query(models.Transaction).all()
    for t in txns:
        try:
            items = json.loads(t.food_json or "[]")
            for item in items:
                counter[item["item"]] += item["qty"]
                revenue_counter[item["item"]] += item.get("price", 0)
        except: pass

    # From food-only orders
    orders = db.query(models.FoodOnlyOrder).all()
    for o in orders:
        try:
            items = json.loads(o.items or "[]")
            for item in items:
                counter[item["item"]] += item["qty"]
                revenue_counter[item["item"]] += item.get("price", 0)
        except: pass

    # Get menu prices
    menu_items = db.query(models.MenuItem).all()
    price_map  = {m.name: m.price for m in menu_items}

    result = [
        {
            "name":     name,
            "qty":      qty,
            "revenue":  revenue_counter[name] or qty * price_map.get(name, 0),
        }
        for name, qty in counter.most_common()
    ]
    return result
