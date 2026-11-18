"""Fixtures exclusively for the independent, disposable browser lifecycle DB."""
import os
import sys
from pathlib import Path

if os.getenv("DATABASE_URL") != "sqlite:////tmp/hsr-lifecycle-ui.db":
    raise RuntimeError("Only the dedicated /tmp lifecycle QA database is permitted")

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from main import app  # noqa: E402,F401
from database import Base, SessionLocal, engine  # noqa: E402
from deps import hash_password  # noqa: E402
import models  # noqa: E402

with engine.begin() as connection:
    for table in reversed(Base.metadata.sorted_tables):
        connection.execute(table.delete())
if "--cleanup" in sys.argv:
    print("Lifecycle QA residue: 0 rows in every disposable database table")
else:
    with SessionLocal() as db:
        db.add(models.Settings(id=1, username="admin", password=hash_password("admin123"), staff_username="staff", staff_password=hash_password("staff123")))
        db.add(models.SecurityControl(manager_pin_hash=hash_password("2468"), require_pin_for_resets=False, alert_unbilled_minutes=180))
        db.add(models.Member(customer_id="CUSQA", name="QA Close Member", phone="9876500001", hourly_rate=240))
        db.add(models.MenuItem(name="QA Water", price=20, available=True))
        db.commit()
    print("Seeded isolated lifecycle QA identities and menu; no production access")
