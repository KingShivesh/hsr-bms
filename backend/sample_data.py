from database import SessionLocal, engine, Base
import models
from datetime import datetime, timedelta
import random
import time
from hsr_config import rate_for_table

db = SessionLocal()

# ==================== MEMBERS ====================
members = [
    ("Rahul Sharma",   "CUS001", 24, 4800, "Premium"),
    ("Arjun Singh",    "CUS002", 18, 3600, "Premium"),
    ("Vikram Patel",   "CUS003", 12, 2400, "Regular"),
    ("Rohan Mehta",    "CUS004", 9,  1800, "Regular"),
    ("Karan Kapoor",   "CUS005", 7,  1400, "Regular"),
    ("Aditya Kumar",   "CUS006", 5,  1000, "Regular"),
    ("Sanjay Gupta",   "CUS007", 3,  600,  "Regular"),
    ("Nikhil Verma",   "CUS008", 2,  400,  "Regular"),
]

# Clear existing members first
db.query(models.Member).delete()
db.commit()

for name, cid, visits, spent, typ in members:
    db.add(models.Member(
        customer_id = cid,
        name        = name,
        visits      = visits,
        spent       = spent,
        member_type = typ,
        last_visit  = (datetime.now() - timedelta(days=random.randint(1, 30))).strftime("%d/%m/%Y")
    ))

db.commit()
print("Members added!")

# ==================== TRANSACTIONS ====================
customers = ["Rahul Sharma", "Arjun Singh", "Vikram Patel", "Rohan Mehta",
             "Karan Kapoor", "Aditya Kumar", "Sanjay Gupta", "Nikhil Verma",
             "Walk-in 1", "Walk-in 2"]

tables = ["T1", "T2", "T3", "T4", "T5"]
food_options = ["French Fries x1", "Tea x2", "Veg Nuggets x1", "None",
                "Chicken Nuggets x1", "Plain Maggie x1", "Cool Drinks 200ml x2", "None", "None"]

# Clear existing transactions
db.query(models.Transaction).delete()
db.commit()

for i in range(40):
    days_ago  = random.randint(0, 14)
    hours_ago = random.randint(0, 10)
    dt        = datetime.now() - timedelta(days=days_ago, hours=hours_ago)
    duration  = random.randint(20, 120)
    tbl       = random.choice(tables)
    rate      = rate_for_table(tbl, 170)
    play      = round((duration / 60) * rate)
    food_str  = random.choice(food_options)
    food_amt  = 0 if food_str == "None" else random.choice([25, 50, 60, 65, 80])
    total     = play + food_amt

    db.add(models.Transaction(
        date          = dt.strftime("%d/%m/%Y, %H:%M:%S"),
        ts            = dt.timestamp() * 1000,
        table_id      = tbl,
        customer_name = random.choice(customers),
        duration      = duration,
        play_charge   = play,
        food_charge   = food_amt,
        food_items    = food_str,
        food_json     = "[]",
        total         = total
    ))

db.commit()
print("Transactions added!")
print("All sample data loaded successfully!")
db.close()
