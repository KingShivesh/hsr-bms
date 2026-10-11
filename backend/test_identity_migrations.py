"""Reversible identity schema checks on SQLite and a disposable PostgreSQL schema."""
import os
import unittest
from urllib.parse import urlsplit
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from migrations import migrate, downgrade
from migrations import identity_001_columns, identity_002_backfill, identity_003_constraints


class IdentityMigrationTests(unittest.TestCase):
    def test_ordered_upgrade_backfill_and_rollback(self):
        url = os.getenv("HSR_TEST_DATABASE_URL", "sqlite:///:memory:")
        if not url.startswith("sqlite:"):
            parsed = urlsplit(url)
            if parsed.hostname not in {"localhost", "127.0.0.1"} or not parsed.path.startswith("/hsr_"):
                raise RuntimeError("Disposable loopback hsr_* database required")
        engine = create_engine(url)
        try:
            with engine.begin() as conn:
                if engine.dialect.name == "postgresql":
                    conn.execute(text("CREATE SCHEMA hsr_identity_migration_qa"))
                    conn.execute(text("SET LOCAL search_path TO hsr_identity_migration_qa"))
                conn.execute(text("CREATE TABLE active_sessions (table_id VARCHAR PRIMARY KEY, customer_name VARCHAR, started_at FLOAT)"))
                conn.execute(text("CREATE TABLE transactions (id INTEGER PRIMARY KEY, customer_name VARCHAR, session_started_at FLOAT)"))
                conn.execute(text("CREATE TABLE bookings (id INTEGER PRIMARY KEY)"))
                conn.execute(text("INSERT INTO active_sessions VALUES ('t1', 'Existing player', 123)"))
                identity_001_columns.up(conn)
                conn.execute(text("UPDATE active_sessions SET player_type=NULL, member_id='CUSQA'"))
                identity_002_backfill.up(conn)
                self.assertEqual(conn.execute(text("SELECT player_type FROM active_sessions")).scalar(), "member")
                identity_003_constraints.up(conn)
                conn.execute(text("INSERT INTO active_sessions (table_id, customer_name) VALUES ('t2', NULL)"))
                self.assertEqual(conn.execute(text("SELECT player_type FROM active_sessions WHERE table_id='t2'")).scalar(), "guest")
                with self.assertRaises(IntegrityError):
                    with conn.begin_nested():
                        conn.execute(text("UPDATE active_sessions SET player_type=NULL WHERE table_id='t2'"))
                identity_003_constraints.down(conn)
                identity_002_backfill.down(conn)
                self.assertIsNone(conn.execute(text("SELECT player_type FROM active_sessions WHERE table_id='t1'")).scalar())
                identity_001_columns.down(conn)
                self.assertNotIn("player_type", {c["name"] for c in inspect(conn).get_columns("active_sessions")})
                self.assertEqual(conn.execute(text("SELECT customer_name FROM active_sessions WHERE table_id='t1'")).scalar(), "Existing player")
                migrate(conn)
                migrate(conn)
                self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM hsr_schema_migrations")).scalar(), 3)
                downgrade(conn)
                if engine.dialect.name == "postgresql":
                    conn.execute(text("DROP SCHEMA hsr_identity_migration_qa CASCADE"))
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
