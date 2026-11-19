"""Only a disposable loopback hsr_* Postgres database may be exercised."""
import os
import time
import unittest

from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import DBAPIError, TimeoutError
from sqlalchemy.pool import NullPool

from database_config import database_config, set_transaction_timeouts


class ConfigurationTests(unittest.TestCase):
    def test_production_never_falls_back_to_sqlite(self):
        for marker in ({"APP_ENV": "production"}, {"RENDER": "true"}):
            for url in ("", "sqlite:///:memory:"):
                with self.assertRaisesRegex(RuntimeError, "PostgreSQL"):
                    database_config({**marker, "DATABASE_URL": url})

    def test_development_retains_disposable_sqlite(self):
        _, sqlite, options = database_config({})
        self.assertTrue(sqlite)
        self.assertNotIn("pool_size", options)

    def test_url_normalization_preserves_password(self):
        url, _, _ = database_config({"APP_ENV": "production", "DATABASE_URL": "postgresql://qa:postgres://@localhost/hsr_qa"})
        self.assertEqual(url.password, "postgres://")

    def test_supported_url_dialects_and_pooler_safe_settings(self):
        for prefix in ("postgres", "postgresql", "postgresql+psycopg", "postgresql+psycopg2"):
            url, sqlite, options = database_config({"APP_ENV": "production", "DATABASE_URL": f"{prefix}://qa:qa@localhost/hsr_qa"})
            self.assertFalse(sqlite)
            self.assertEqual(options["pool_timeout"], 5)
            self.assertEqual(options["pool_recycle"], 300)
            self.assertEqual(options["connect_args"]["connect_timeout"], 5)
            if url.drivername == "postgresql+psycopg":
                self.assertIsNone(options["connect_args"]["prepare_threshold"])


class PostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = os.getenv("HSR_TEST_DATABASE_URL", "")
        if not raw:
            raise unittest.SkipTest("Set HSR_TEST_DATABASE_URL for disposable Postgres checks")
        url, _, options = database_config({"APP_ENV": "production", "DATABASE_URL": raw})
        if url.host not in {"localhost", "127.0.0.1"} or not url.database.startswith("hsr_"):
            raise RuntimeError("Refusing non-disposable database")
        cls.url = url
        cls.engine = create_engine(url, **options)
        event.listen(cls.engine, "begin", set_transaction_timeouts)

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    def test_transaction_timeouts_reset_without_session_leak(self):
        with self.engine.connect() as conn:
            self.assertEqual(conn.scalar(text("SHOW statement_timeout")), "10s")
            self.assertEqual(conn.scalar(text("SHOW lock_timeout")), "5s")
            self.assertEqual(conn.scalar(text("SHOW idle_in_transaction_session_timeout")), "15s")
        clean = create_engine(self.url, poolclass=NullPool)
        try:
            with clean.connect() as conn:
                self.assertEqual(conn.scalar(text("SHOW statement_timeout")), "0")
        finally:
            clean.dispose()

    def test_slow_query_fails_then_next_transaction_recovers(self):
        began = time.monotonic()
        with self.assertRaises(DBAPIError):
            with self.engine.connect() as conn:
                conn.execute(text("SELECT pg_sleep(11)"))
        duration = time.monotonic() - began
        self.assertGreater(duration, 9)
        self.assertLess(duration, 12)
        with self.engine.connect() as conn:
            self.assertEqual(conn.scalar(text("SELECT 1")), 1)
        print(f"statement_timeout: {duration:.3f}s; next transaction recovered")

    def test_exhausted_pool_fails_in_five_seconds(self):
        connections = [self.engine.connect() for _ in range(10)]
        began = time.monotonic()
        try:
            with self.assertRaises(TimeoutError):
                self.engine.connect()
        finally:
            for conn in connections:
                conn.close()
        duration = time.monotonic() - began
        self.assertGreater(duration, 4.5)
        self.assertLess(duration, 6)
        print(f"pool_timeout: {duration:.3f}s; checked_out={self.engine.pool.checkedout()}")

    def test_dead_idle_connection_is_replaced(self):
        self.engine.dispose()
        with self.engine.connect() as conn:
            pid = conn.scalar(text("SELECT pg_backend_pid()"))
        killer = create_engine(self.url, poolclass=NullPool)
        try:
            with killer.begin() as conn:
                conn.execute(text("SELECT pg_terminate_backend(:pid)"), {"pid": pid})
            with self.engine.connect() as conn:
                self.assertNotEqual(conn.scalar(text("SELECT pg_backend_pid()")), pid)
                self.assertEqual(conn.scalar(text("SELECT 1")), 1)
        finally:
            killer.dispose()
        self.assertEqual(self.engine.pool.checkedout(), 0)

    def test_lock_wait_times_out_then_recovers(self):
        with self.engine.begin() as holder:
            holder.execute(text("SELECT pg_advisory_xact_lock(48539999)"))
            began = time.monotonic()
            with self.assertRaises(DBAPIError):
                with self.engine.begin() as waiter:
                    waiter.execute(text("SELECT pg_advisory_xact_lock(48539999)"))
            duration = time.monotonic() - began
        self.assertGreater(duration, 4.5)
        self.assertLess(duration, 7)
        with self.engine.connect() as conn:
            self.assertEqual(conn.scalar(text("SELECT 1")), 1)
        print(f"lock_timeout: {duration:.3f}s; next transaction recovered")

    def test_idle_transaction_disconnect_recovers(self):
        conn = self.engine.connect()
        try:
            conn.execute(text("SELECT 1"))
            time.sleep(16)
            with self.assertRaises(DBAPIError):
                conn.execute(text("SELECT 1"))
        finally:
            conn.close()
        with self.engine.connect() as recovered:
            self.assertEqual(recovered.scalar(text("SELECT 1")), 1)
        self.assertEqual(self.engine.pool.checkedout(), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
