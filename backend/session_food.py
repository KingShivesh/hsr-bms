"""Stable session order lines; cancellations retain audit history, not bill value."""
import json

def session_food_lines(session, *, include_cancelled=False):
    rows = json.loads(session.food_items or "[]")
    return [{**row, "id": row.get("id") or f"legacy-{index}", "served": bool(row.get("served", False))}
            for index, row in enumerate(rows) if include_cancelled or not row.get("cancelled_at")]

def store_session_food(session, rows):
    session.food_items = json.dumps(rows)
    session.food_total = sum(int(row["price"]) for row in rows if not row.get("cancelled_at"))
