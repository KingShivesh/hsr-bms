"""Extend the enforced identity set without rewriting existing session/receipt rows."""
from sqlalchemy import text

def constraint(conn, *, allow_walk_in):
    states = "'guest','member','booking','walk_in'" if allow_walk_in else "'guest','member','booking'"
    for table in ("active_sessions", "transactions"):
        if conn.dialect.name == "postgresql":
            conn.execute(text(f"ALTER TABLE {table} DROP CONSTRAINT {table}_player_type_check"))
            conn.execute(text(f"ALTER TABLE {table} ADD CONSTRAINT {table}_player_type_check CHECK (player_type IN ({states}))"))
        else:
            for action in ("insert", "update"):
                conn.execute(text(f"DROP TRIGGER {table}_identity_{action}"))
                conn.execute(text(f"CREATE TRIGGER {table}_identity_{action} BEFORE {action.upper()} ON {table} WHEN NEW.player_type IS NULL OR NEW.player_type NOT IN ({states}) BEGIN SELECT RAISE(ABORT, 'Invalid player_type'); END"))

def up(conn):
    constraint(conn, allow_walk_in=True)

def down(conn):
    for table in ("active_sessions", "transactions"):
        if conn.execute(text(f"SELECT COUNT(*) FROM {table} WHERE player_type='walk_in'")).scalar():
            raise RuntimeError("Cannot remove walk_in identity while name-only sessions or receipts exist")
    constraint(conn, allow_walk_in=False)
