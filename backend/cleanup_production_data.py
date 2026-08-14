from database import SessionLocal, Base, engine, ensure_runtime_columns
import models


DUMMY_NAMES = {
    "cvc",
    "nnn",
    "test",
    "test customer",
    "demo",
    "sample",
    "dummy",
    "asdf",
    "foo",
    "bar",
    "label",
    "customer",
    "customers",
}


def is_dummy(value):
    return str(value or "").strip().lower() in DUMMY_NAMES


def delete_matching(db, model, field_name):
    field = getattr(model, field_name)
    rows = db.query(model).all()
    doomed = [row for row in rows if is_dummy(getattr(row, field_name, ""))]
    for row in doomed:
        db.delete(row)
    return len(doomed)


def main():
    Base.metadata.create_all(bind=engine)
    ensure_runtime_columns()
    db = SessionLocal()
    try:
        counts = {
            "members": delete_matching(db, models.Member, "name"),
            "waitlist_entries": delete_matching(db, models.WaitlistEntry, "customer_name"),
            "bookings": delete_matching(db, models.Booking, "customer_name"),
            "transactions": delete_matching(db, models.Transaction, "customer_name"),
            "food_only_orders": delete_matching(db, models.FoodOnlyOrder, "customer_name"),
            "challenges": delete_matching(db, models.Challenge, "player_name"),
        }
        db.commit()
        print("Dummy data cleanup complete.")
        for table, count in counts.items():
            print(f"{table}: removed {count}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
