import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./hsr_billiards.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

is_sqlite = DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}
engine_options = {
    "connect_args": connect_args,
    "pool_pre_ping": True,
}
if not is_sqlite:
    engine_options.update({
        "pool_size": 10,
        "max_overflow": 20,
    })

engine = create_engine(DATABASE_URL, **engine_options)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def ensure_runtime_columns():
    """Add lightweight columns that were introduced after initial installs."""
    columns = {
        "settings": {
            "wr": "INTEGER DEFAULT 320",
            "booking_grace_minutes": "INTEGER DEFAULT 10",
            "staff_username": "VARCHAR(255) DEFAULT 'staff'",
            "staff_password": "VARCHAR(255) DEFAULT 'staff123'",
        },
        "bookings": {
            "released_at": "VARCHAR(255) DEFAULT ''",
        },
        "active_sessions": {
            "billing_mode": "VARCHAR(50) DEFAULT 'single'",
            "players_json": "TEXT DEFAULT '[]'",
            "session_key": "VARCHAR(255) DEFAULT ''",
        },
        "session_frames": {
            "session_key": "VARCHAR(255) DEFAULT ''",
        },
        "transactions": {
            "billing_mode": "VARCHAR(50) DEFAULT 'single'",
            "players_json": "TEXT DEFAULT '[]'",
            "payer_name": "VARCHAR(255) DEFAULT ''",
            "payment_split_json": "TEXT DEFAULT '[]'",
            "discount_reason": "TEXT DEFAULT ''",
            "session_key": "VARCHAR(255) DEFAULT ''",
            "session_started_at": "FLOAT DEFAULT 0",
            "session_ended_at": "FLOAT DEFAULT 0",
        },
        "food_only_orders": {
            "payment_method": "VARCHAR(50) DEFAULT 'Cash'",
        },
        "members": {
            "phone": "VARCHAR(255) DEFAULT ''",
            "loyalty_points": "INTEGER DEFAULT 0",
            "notes": "TEXT DEFAULT ''",
        },
        "audit_logs": {
            "table_id": "VARCHAR(50) DEFAULT ''",
        },
    }
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, required in columns.items():
            if table not in existing_tables:
                continue
            existing = {
                column["name"]
                for column in inspector.get_columns(table)
            }
            for column, ddl in required.items():
                if column not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
        ensure_runtime_indexes(conn, existing_tables)

def ensure_runtime_indexes(conn, existing_tables: set[str]):
    indexes = {
        "transactions": [
            ("idx_transactions_date", "date"),
            ("idx_transactions_ts", "ts"),
            ("idx_transactions_table_ts", "table_id, ts"),
        ],
        "food_only_orders": [
            ("idx_food_only_orders_date", "date"),
            ("idx_food_only_orders_ts", "ts"),
        ],
        "active_sessions": [
            ("idx_active_sessions_customer", "customer_name"),
        ],
        "session_frames": [
            ("idx_session_frames_table_key", "table_id, session_key"),
        ],
        "closed_session_frames": [
            ("idx_closed_session_frames_transaction", "transaction_id"),
            ("idx_closed_session_frames_table_key", "table_id, session_key"),
        ],
        "session_events": [
            ("idx_session_events_table_ts", "table_id, ts"),
            ("idx_session_events_key_ts", "session_key, ts"),
            ("idx_session_events_type_ts", "event_type, ts"),
        ],
        "bookings": [
            ("idx_bookings_status_time", "status, booking_time"),
        ],
        "audit_logs": [
            ("idx_audit_logs_table_ts", "table_id, ts"),
            ("idx_audit_logs_action_ts", "action, ts"),
        ],
        "day_closes": [
            ("idx_day_closes_business_date", "business_date"),
        ],
    }
    for table, table_indexes in indexes.items():
        if table not in existing_tables:
            continue
        for index_name, columns in table_indexes:
            conn.execute(text(
                f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({columns})"
            ))

def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
