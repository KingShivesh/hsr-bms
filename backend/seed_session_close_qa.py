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
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    with SessionLocal() as db:
        db.add(models.Settings(id=1, username="admin", password=hash_password("admin123"), staff_username="staff", staff_password=hash_password("staff123")))
        db.add(models.SecurityControl(manager_pin_hash=hash_password("2468"), require_pin_for_resets=False, alert_unbilled_minutes=180))
        db.add(models.Member(customer_id="CUSQA", name="QA Close Member", phone="9876500001", hourly_rate=240))
        now = time.time() * 1000
        db.add(models.ActiveSession(table_id="t1", started_at=now - 45 * 60000, start_time=now - 45 * 60000, rate=320, customer_name=None, session_key="qa-close-t1", total_paused_ms=0, paused_at=0, rate_multiplier=1, rate_label=""))
        db.add(models.ActiveSession(table_id="t2", started_at=now - 181 * 60000, start_time=now - 181 * 60000, rate=320, customer_name=None, session_key="qa-close-t2", total_paused_ms=0, paused_at=0, rate_multiplier=1, rate_label=""))
        db.commit()
    print("Seeded two anonymous sessions and three available tables in local QA only")
