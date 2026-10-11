from sqlalchemy import text


def up(conn):
    for table, timestamp in (("active_sessions", "started_at"), ("transactions", "session_started_at")):
        if conn.dialect.name == "postgresql":
            conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN player_type SET DEFAULT 'guest'"))
            conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN player_type SET NOT NULL"))
            conn.execute(text(f"ALTER TABLE {table} ADD CONSTRAINT {table}_player_type_check CHECK (player_type IN ('guest','member','booking'))"))
        else:
            for action in ("INSERT", "UPDATE"):
                conn.execute(text(f"CREATE TRIGGER {table}_identity_{action.lower()} BEFORE {action} ON {table} WHEN NEW.player_type IS NULL OR NEW.player_type NOT IN ('guest','member','booking') BEGIN SELECT RAISE(ABORT, 'Invalid player_type'); END"))
        conn.execute(text(f"CREATE INDEX idx_{table}_identity_started ON {table} (player_type, {timestamp})"))
        conn.execute(text(f"CREATE INDEX idx_{table}_member ON {table} (member_id)"))


def down(conn):
    for table in ("active_sessions", "transactions"):
        conn.execute(text(f"DROP INDEX idx_{table}_identity_started"))
        conn.execute(text(f"DROP INDEX idx_{table}_member"))
        if conn.dialect.name == "postgresql":
            conn.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT {table}_player_type_check"))
            conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN player_type DROP NOT NULL"))
        else:
            for action in ("insert", "update"):
                conn.execute(text(f"DROP TRIGGER {table}_identity_{action}"))
