from sqlalchemy import inspect, text

COLUMNS = {
    "active_sessions": {"player_type": "VARCHAR(20) DEFAULT 'guest'", "member_id": "VARCHAR", "booking_id": "INTEGER", "player_count": "INTEGER DEFAULT 2"},
    "transactions": {"player_type": "VARCHAR(20) DEFAULT 'guest'", "member_id": "VARCHAR", "booking_id": "INTEGER", "player_count": "INTEGER DEFAULT 2"},
    "bookings": {"member_id": "VARCHAR", "session_key": "VARCHAR", "pricing_json": "TEXT"},
}


def up(conn):
    inspector = inspect(conn)
    for table, columns in COLUMNS.items():
        existing = {col["name"] for col in inspector.get_columns(table)}
        for column, ddl in columns.items():
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def down(conn):
    for table, columns in COLUMNS.items():
        for column in reversed(columns):
            conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
