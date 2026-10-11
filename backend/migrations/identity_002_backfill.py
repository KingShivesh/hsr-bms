from sqlalchemy import text

TABLES = {"active_sessions": "table_id", "transactions": "id"}


def up(conn):
    conn.execute(text("CREATE TABLE identity_backfill_backup (table_name VARCHAR(40), row_key VARCHAR(255), player_type VARCHAR(20))"))
    for table, key in TABLES.items():
        conn.execute(text(f"INSERT INTO identity_backfill_backup SELECT '{table}', CAST({key} AS VARCHAR), player_type FROM {table} WHERE player_type IS NULL"))
        conn.execute(text(f"UPDATE {table} SET player_type=CASE WHEN booking_id IS NOT NULL THEN 'booking' WHEN member_id IS NOT NULL THEN 'member' ELSE 'guest' END WHERE player_type IS NULL"))


def down(conn):
    for table, key in TABLES.items():
        conn.execute(text(f"UPDATE {table} SET player_type=NULL WHERE CAST({key} AS VARCHAR) IN (SELECT row_key FROM identity_backfill_backup WHERE table_name='{table}')"))
    conn.execute(text("DROP TABLE identity_backfill_backup"))
