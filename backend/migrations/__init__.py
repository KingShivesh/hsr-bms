"""Ordered, individually reversible session identity migrations."""

from importlib import import_module
from sqlalchemy import text

STEPS = ("identity_001_columns", "identity_002_backfill", "identity_003_constraints")


def migrate(conn):
    conn.execute(text("CREATE TABLE IF NOT EXISTS hsr_schema_migrations (version VARCHAR(100) PRIMARY KEY)"))
    applied = set(conn.execute(text("SELECT version FROM hsr_schema_migrations")).scalars())
    for name in STEPS:
        if name in applied:
            continue
        import_module(f"migrations.{name}").up(conn)
        conn.execute(text("INSERT INTO hsr_schema_migrations (version) VALUES (:version)"), {"version": name})


def downgrade(conn, keep=0):
    applied = set(conn.execute(text("SELECT version FROM hsr_schema_migrations")).scalars())
    for name in reversed(STEPS[keep:]):
        if name not in applied:
            continue
        import_module(f"migrations.{name}").down(conn)
        conn.execute(text("DELETE FROM hsr_schema_migrations WHERE version=:version"), {"version": name})
