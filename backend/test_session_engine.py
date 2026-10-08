"""Session regressions against a disposable SQLite or loopback PostgreSQL DB."""

import json
import os
import tempfile
import time
import unittest
from datetime import datetime
from unittest.mock import patch
from urllib.parse import urlsplit

test_url = os.getenv("HSR_TEST_DATABASE_URL", "")
temp_db = None
if test_url:
    parsed = urlsplit(test_url)
    if parsed.hostname not in {"localhost", "127.0.0.1"} or not parsed.path.startswith("/hsr_"):
        raise RuntimeError("Tests require a disposable loopback hsr_* database")
else:
    temp_db = tempfile.TemporaryDirectory(prefix="hsr-session-engine-")
    test_url = f"sqlite:///{temp_db.name}/sessions.db"
os.environ["DATABASE_URL"] = test_url
os.environ.setdefault("SECRET_KEY", "session-engine-test-secret-at-least-32-characters")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import inspect, text  # noqa: E402
from database import Base, SessionLocal, engine, ensure_runtime_columns  # noqa: E402
from deps import create_token  # noqa: E402
from main import app  # noqa: E402
import models  # noqa: E402


class SessionEngineTests(unittest.TestCase):
    def setUp(self):
        with engine.begin() as connection:
            for table in reversed(Base.metadata.sorted_tables):
                connection.execute(table.delete())
        with SessionLocal() as db:
            db.add(models.Settings(id=1, min_session=0, gst_percent=0))
            db.add(models.MenuItem(name="QA Engine Tea", price=20, category="Beverages", available=True))
            db.commit()
        self.client = TestClient(app)
        self.client.headers["Authorization"] = f"Bearer {create_token('qa-engine', 'admin')}"
        self.now = time.time() * 1000
        self.clock = patch("routers.sessions.time.time", side_effect=lambda: self.now / 1000)
        self.clock.start()

    def tearDown(self):
        self.clock.stop()
        self.client.close()
        with engine.begin() as connection:
            for table in reversed(Base.metadata.sorted_tables):
                connection.execute(table.delete())

    def call(self, method, path, expected=200, **kwargs):
        response = self.client.request(method, path, **kwargs)
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    def start(self, table="t1", **options):
        return self.call("POST", "/sessions/start", json={
            "table_id": table, "customer_name": "QA Engine Player", "rate": 320, **options,
        })

    def quote(self, table="t1"):
        return self.call("GET", f"/sessions/quote/{table}")

    def peak(self, multiplier):
        with SessionLocal() as db:
            rule = db.query(models.PeakHourRate).first()
            if rule is None:
                rule = models.PeakHourRate(start_hour=0, end_hour=24, label="QA Engine Peak")
                db.add(rule)
            rule.multiplier = multiplier
            db.commit()

    def test_pause_resume_preserves_original_start_and_excludes_breaks(self):
        started = self.now
        self.start()
        self.now += 60_000
        self.call("POST", "/sessions/pause/t1")
        frozen = self.quote()
        self.now += 120_000
        self.assertEqual(self.quote()["tot"], frozen["tot"])
        self.call("POST", "/sessions/pause/t1")
        self.now += 60_000
        quote = self.quote()
        self.assertEqual(quote["dur"], 2)
        self.assertEqual(quote["session_started_at"], started)
        bill = self.call("POST", "/sessions/stop/t1", params={"session_key": quote["session_key"]})
        self.assertEqual(bill["session_started_at"], started)
        self.assertEqual(bill["dur"], 2)

    def test_peak_rate_is_snapshotted_at_start(self):
        self.peak(1.5)
        self.start()
        self.now += 60 * 60_000
        before = self.quote()
        self.assertEqual(before["ply"], 480)
        self.peak(0.5)
        after = self.quote()
        self.assertEqual(after["ply"], 480)
        self.assertEqual(after["peak_label"], "QA Engine Peak")
        live = self.call("GET", "/sessions/active")
        self.assertEqual(next(row for row in live if row["table_id"] == "t1")["play_estimate"], after["ply"])
        bill = self.call("POST", "/sessions/stop/t1", params={"session_key": after["session_key"]})
        self.assertEqual(bill["ply"], after["ply"])

    def test_standard_rate_does_not_pick_up_a_later_peak(self):
        self.start()
        self.now += 60 * 60_000
        self.peak(1.5)
        self.assertEqual(self.quote()["ply"], 320)

    def test_peak_window_rollover_does_not_change_started_session(self):
        self.peak(1.5)
        with SessionLocal() as db:
            rule = db.query(models.PeakHourRate).first()
            rule.start_hour, rule.end_hour = 8, 9
            db.commit()
        with patch("pricing.get_ist_now", return_value=datetime(2026, 10, 9, 8, 30)):
            self.start()
        self.now += 60 * 60_000
        with patch("pricing.get_ist_now", return_value=datetime(2026, 10, 9, 9, 30)):
            self.assertEqual(self.quote()["ply"], 480)

    def test_paused_checkout_cannot_record_a_future_end(self):
        self.start()
        self.now += 60_000
        self.call("POST", "/sessions/pause/t1")
        quote = self.call("GET", "/sessions/quote/t1", params={"closed_at_ms": self.now + 3600_000})
        self.assertEqual(quote["session_ended_at"], self.now)
        self.assertEqual(quote["dur"], 1)

    def test_duplicate_checkout_is_one_transaction_and_stale_key_is_rejected(self):
        self.start()
        self.now += 60_000
        key = self.quote()["session_key"]
        first = self.call("POST", "/sessions/stop/t1", params={"session_key": key})
        second = self.call("POST", "/sessions/stop/t1", params={"session_key": key})
        self.assertTrue(second["idempotent"])
        self.assertEqual(first["tot"], second["tot"])
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Transaction).count(), 1)
        self.start()
        self.call("POST", "/sessions/stop/t1", expected=409, params={"session_key": key})
        self.assertIn("t1", [row["table_id"] for row in self.call("GET", "/sessions/active")])

    def test_session_food_is_included_once_on_bill(self):
        self.start()
        self.call("POST", "/sessions/t1/food", json={"item": "QA Engine Tea", "qty": 2})
        self.now += 60_000
        quote = self.quote()
        self.assertEqual(quote["famt"], 40)
        bill = self.call("POST", "/sessions/stop/t1", params={"session_key": quote["session_key"]})
        self.assertEqual(bill["tot"], bill["ply"] + 40)
        self.assertEqual(bill["famt"], 40)

    def test_table_transfer_keeps_session_identity_and_start(self):
        started = self.now
        self.start()
        key = self.quote()["session_key"]
        self.now += 60_000
        self.call("POST", "/sessions/pause/t1")
        self.now += 120_000
        self.call("POST", "/sessions/pause/t1")
        self.call("POST", "/sessions/transfer/t1", json={"target_table_id": "t2"})
        quote = self.quote("t2")
        self.assertEqual(quote["session_key"], key)
        self.assertEqual(quote["session_started_at"], started)

    def test_legacy_open_session_keeps_existing_pricing_policy(self):
        with SessionLocal() as db:
            db.add(models.ActiveSession(table_id="t1", start_time=self.now - 60 * 60_000,
                                       customer_name="QA Legacy Engine", rate=320, session_key="qa-legacy"))
            db.commit()
        self.peak(1.5)
        self.assertEqual(self.quote()["ply"], 480)
        self.peak(0.5)
        self.assertEqual(self.quote()["ply"], 160)

    def test_legacy_resumed_session_recovers_start_from_audit_event(self):
        original = self.now - 180_000
        with SessionLocal() as db:
            db.add(models.ActiveSession(table_id="t1", start_time=self.now - 60_000,
                                       customer_name="QA Legacy Engine", rate=320, session_key="qa-legacy"))
            db.add(models.SessionEvent(table_id="T1", session_key="qa-legacy", event_type="session_started",
                                       ts=original, payload_json=json.dumps({"started_at": original})))
            db.commit()
        self.call("POST", "/sessions/pause/t1")
        self.assertEqual(self.quote()["session_started_at"], original)

    def test_multiple_breaks_accumulate_without_changing_original_start(self):
        started = self.now
        self.start()
        for play_minutes, break_minutes in [(1, 3), (2, 4)]:
            self.now += play_minutes * 60_000
            self.call("POST", "/sessions/pause/t1")
            self.now += break_minutes * 60_000
            self.call("POST", "/sessions/pause/t1")
        self.now += 3 * 60_000
        self.assertEqual(self.quote()["dur"], 6)
        with SessionLocal() as db:
            session = db.get(models.ActiveSession, "t1")
            self.assertEqual(session.started_at, started)
            self.assertEqual(session.total_paused_ms, 7 * 60_000)
            self.assertEqual(session.paused_at, 0)

    def test_frame_archival_uses_original_start_after_resume(self):
        started = self.now
        self.start(billing_mode="lp", players=["QA Engine Player", "QA Engine Opponent"])
        self.now += 60_000
        self.call("POST", "/sessions/pause/t1")
        self.now += 120_000
        self.call("POST", "/sessions/pause/t1")
        self.call("POST", "/sessions/t1/frames/start")
        with SessionLocal() as db:
            self.assertEqual(db.query(models.SessionFrame).first().session_started_at, started)
        self.call("POST", "/sessions/t1/frames/close", json={"loser_name": "QA Engine Opponent"})
        key = self.quote()["session_key"]
        self.call("POST", "/sessions/stop/t1", params={"session_key": key})
        with SessionLocal() as db:
            self.assertEqual(db.query(models.ClosedSessionFrame).first().session_started_at, started)

    def test_existing_split_payment_recording_still_matches_the_bill(self):
        self.start()
        self.now += 60 * 60_000
        quote = self.quote()
        self.call("POST", "/sessions/stop/t1", expected=400, params={
            "session_key": quote["session_key"], "payment_split_json": json.dumps([{"method": "Cash", "amount": 1}]),
        })
        bill = self.call("POST", "/sessions/stop/t1", params={
            "session_key": quote["session_key"],
            "payment_split_json": json.dumps([{"method": "Cash", "amount": 200}, {"method": "UPI", "amount": 120}]),
        })
        self.assertEqual(bill["payment_method"], "Split")
        self.assertEqual(sum(row["amount"] for row in bill["payment_split"]), bill["tot"])

    def test_additive_schema_upgrade_preserves_legacy_rows(self):
        columns = ["started_at", "paused_at", "total_paused_ms", "rate_multiplier", "rate_label"]
        with SessionLocal() as db:
            db.add(models.ActiveSession(table_id="t1", customer_name="QA Legacy Engine", start_time=self.now, rate=320))
            db.commit()
        try:
            with engine.begin() as connection:
                for column in columns:
                    connection.execute(text(f"ALTER TABLE active_sessions DROP COLUMN {column}"))
            ensure_runtime_columns()
            names = {column["name"] for column in inspect(engine).get_columns("active_sessions")}
            self.assertTrue(set(columns).issubset(names))
            with SessionLocal() as db:
                session = db.get(models.ActiveSession, "t1")
                self.assertEqual(session.customer_name, "QA Legacy Engine")
                self.assertEqual(session.start_time, self.now)
                self.assertIsNone(session.rate_multiplier)
                self.assertIsNone(session.started_at)
        finally:
            ensure_runtime_columns()

    def test_health_identifies_the_render_release(self):
        revision = "a" * 40
        with patch.dict(os.environ, {"RENDER_GIT_COMMIT": revision}):
            self.assertEqual(self.call("GET", "/health")["revision"], revision)


if __name__ == "__main__":
    try:
        unittest.main(verbosity=2)
    finally:
        engine.dispose()
        if temp_db:
            temp_db.cleanup()
