"""Seed/reset only the specifically named disposable browser QA database."""
import os
import sys
import time

if os.getenv("DATABASE_URL") != "sqlite:////tmp/hsr-session-close-ui.db":
    raise RuntimeError("The dedicated /tmp browser QA database is required")

from main import app  # noqa: E402,F401
from database import SessionLocal, engine, Base  # noqa: E402
from deps import hash_password  # noqa: E402
from session_alerts import collect_alerts  # noqa: E402
import models  # noqa: E402

if "--alerts" in sys.argv:
    collect_alerts()
elif "--cleanup" in sys.argv:
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    print("QA residue: 0 rows in all disposable database tables")
else:
    with SessionLocal() as db:
        for table in reversed(Base.metadata.sorted_tables):
            db.execute(table.delete())
        db.add(models.Settings(id=1, username="admin", password=hash_password("admin123"), staff_username="staff", staff_password=hash_password("staff123")))
        db.add(models.SecurityControl(manager_pin_hash=hash_password("2468"), require_pin_for_resets=False, alert_unbilled_minutes=180))
        db.add(models.Member(customer_id="CUSQA", name="QA Close Member", phone="9876500001", hourly_rate=240))
        if "--food" in sys.argv:
            db.add_all([models.MenuItem(name=name, price=price, available=True) for name, price in [("QA Cold Drink", 45), ("QA Samosa", 30), ("QA Water", 20), ("QA Coffee", 40)]])
        now = time.time() * 1000
        db.add(models.ActiveSession(table_id="t1", started_at=now - 45 * 60000, start_time=now - 45 * 60000, rate=320, customer_name=None, session_key="qa-close-t1", total_paused_ms=0, paused_at=0, rate_multiplier=1, rate_label=""))
        db.add(models.ActiveSession(table_id="t2", started_at=now - 181 * 60000, start_time=now - 181 * 60000, rate=320, customer_name=None, session_key="qa-close-t2", total_paused_ms=0, paused_at=0, rate_multiplier=1, rate_label=""))
        db.flush()
        if "--food" in sys.argv:
            import json
            session = db.get(models.ActiveSession, "t1")
            session.food_items = json.dumps([{"id": "qa-drink", "item": "QA Cold Drink", "qty": 2, "price": 90, "unit_price": 45, "served": False}, {"id": "qa-samosa", "item": "QA Samosa", "qty": 1, "price": 30, "unit_price": 30, "served": False}])
            session.food_total = 120
        db.commit()
    print("Seeded two anonymous sessions and three available tables in local QA only")
