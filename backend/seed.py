from database import SessionLocal, engine, Base, ensure_runtime_columns
from deps import hash_password
import models
from hsr_config import MENU_ITEMS

Base.metadata.create_all(bind=engine)
ensure_runtime_columns()

db = SessionLocal()

# ==================== SETTINGS ====================
existing = db.query(models.Settings).first()
if not existing:
    db.add(models.Settings(
        username    = "admin",
        password    = hash_password("admin123"),
        wr          = 320,
        pr          = 170,
        sr          = 270,
        min_session = 0,
        booking_grace_minutes = 10,
    ))
    print("Settings seeded!")
else:
    if existing.wr is None:
        existing.wr = 320
    if existing.pr is None:
        existing.pr = 170
    if existing.sr is None:
        existing.sr = 270
    if not hasattr(existing, 'min_session') or existing.min_session is None:
        existing.min_session = 0
    if existing.booking_grace_minutes is None:
        existing.booking_grace_minutes = 10
    if not (existing.password.startswith("$2b$") or existing.password.startswith("$2a$")):
        existing.password = hash_password(existing.password)
        print("Migrated settings password to bcrypt hash.")
    print("Settings already exist, skipping.")

# ==================== HSR MENU ITEMS ====================
legacy_cigarette = db.query(models.MenuItem).filter(
    models.MenuItem.name == "Cigarettes MRP + 3"
).first()
current_cigarette = db.query(models.MenuItem).filter(
    models.MenuItem.name == "Cigarettes"
).first()
if legacy_cigarette and not current_cigarette:
    legacy_cigarette.name = "Cigarettes"
    legacy_cigarette.price = 0
    legacy_cigarette.category = "Cigarettes"
    legacy_cigarette.available = True
elif legacy_cigarette and current_cigarette:
    db.delete(legacy_cigarette)
if legacy_cigarette:
    db.commit()

for name, price, category in MENU_ITEMS:
    existing_item = db.query(models.MenuItem).filter(models.MenuItem.name == name).first()
    if not existing_item:
        db.add(models.MenuItem(
            name      = name,
            price     = price,
            category  = category,
            available = True,
        ))
    else:
        existing_item.price = price
        existing_item.category = category
        existing_item.available = True

db.commit()
print("HSR menu items seeded!")
print("Default rates: T1/T2 Wiraka ₹320/hr, T3/T4 English ₹270/hr, T5 Pool ₹170/hr.")
print("Cigarettes: admin enters manual price at order time.")

db.close()
print("Seed complete.")
