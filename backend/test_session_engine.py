"""Session regressions against a disposable SQLite or loopback PostgreSQL DB."""

import json
import os
import tempfile
import time
import unittest
import csv
import io
from concurrent.futures import ThreadPoolExecutor
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
            db.add(models.Settings(id=1, username="qa-engine", staff_username="qa-staff", min_session=0, gst_percent=0))
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

    def tariffs(self, price=80, packages=None):
        return self.call("POST", "/settings/tariffs", json={
            "frame_rates": {"wr": price, "sr": 60, "pr": 40},
            "packages": packages if packages is not None else [{"id": "qa-fixed", "name": "QA Fixed", "price": 500, "table_group": "wr"}],
        })

    def complete_frame(self, table="t1", loser=""):
        return self.call("POST", f"/sessions/{table}/frames/close", json={"loser_name": loser})

    def test_tariff_catalog_requires_admin_and_valid_prices(self):
        self.assertEqual(self.call("GET", "/settings/tariffs")["packages"], [])
        self.call("POST", "/sessions/start", expected=400, json={"table_id": "t1", "customer_name": "QA", "rate": 1, "tariff_mode": "frame"})
        self.client.headers["Authorization"] = f"Bearer {create_token('qa-staff', 'staff')}"
        self.call("POST", "/settings/tariffs", expected=403, json={"frame_rates": {"wr": 80}})
        self.client.headers["Authorization"] = f"Bearer {create_token('qa-engine', 'admin')}"
        self.call("POST", "/settings/tariffs", expected=422, json={"frame_rates": {"wr": -1}})
        duplicate = [{"id": "same", "name": "QA", "price": 500}] * 2
        self.call("POST", "/settings/tariffs", expected=422, json={"frame_rates": {}, "packages": duplicate})
        self.call("POST", "/settings/tariffs", expected=422, json={"frame_rates": {}, "packages": [{"id": "qa", "name": "  ", "price": 500}]})
        self.call("POST", "/sessions/start", expected=422, json={"table_id": "t1", "customer_name": "QA", "rate": 320, "tariff_mode": "invented"})

    def test_frame_billing_snapshots_price_and_blocks_open_frame(self):
        self.tariffs()
        self.peak(1.5)
        with SessionLocal() as db:
            db.query(models.Settings).first().min_session = 120
            db.commit()
        self.start(tariff_mode="frame", tariff_price=1)
        self.now += 16 * 60 * 60_000
        quote = self.quote()
        self.assertEqual(quote["ply"], 0)
        self.assertTrue(quote["checkout_blocked"])
        self.assertFalse(quote["duration_capped"])
        self.call("POST", "/sessions/stop/t1", expected=409)
        self.complete_frame()
        self.tariffs(price=120)
        self.call("POST", "/sessions/t1/frames/start")
        self.complete_frame()
        self.call("POST", "/sessions/t1/food", json={"item": "QA Engine Tea", "qty": 2})
        quote = self.quote()
        self.assertEqual((quote["ply"], quote["tot"], quote["frame_count"], quote["tariff_price"]), (160, 200, 2, 80))
        self.assertEqual(quote["peak_surcharge"], 0)
        self.assertEqual(self.call("GET", "/sessions/active")[0]["running_total"], 200)
        bill = self.call("POST", "/sessions/stop/t1", params={"session_key": quote["session_key"]})
        replay = self.call("POST", "/sessions/stop/t1", params={"session_key": quote["session_key"]})
        self.assertEqual((bill["tot"], replay["tot"], replay["frame_count"], replay["tariff_price"]), (200, 200, 2, 80))
        self.assertEqual(replay["tariff_mode"], "frame")
        history = self.call("GET", "/reports/history")
        self.assertEqual(history[0]["tariff_mode"], "frame")
        self.assertEqual(history[0]["frame_count"], 2)

    def test_package_price_survives_removal_pause_transfer_and_long_duration(self):
        self.tariffs()
        self.peak(2)
        self.start(tariff_mode="package", package_id="qa-fixed")
        self.now += 120_000
        self.call("POST", "/sessions/pause/t1")
        self.now += 60_000
        self.call("POST", "/sessions/pause/t1")
        self.tariffs(packages=[])
        self.call("POST", "/sessions/transfer/t1", json={"target_table_id": "t5"})
        self.now += 16 * 60 * 60_000
        quote = self.quote("t5")
        self.assertEqual((quote["ply"], quote["tariff_label"], quote["package_id"]), (500, "QA Fixed", "qa-fixed"))
        self.assertEqual(quote["peak_surcharge"], 0)
        bill = self.call("POST", "/sessions/stop/t5", params={"session_key": quote["session_key"]})
        self.assertEqual(bill["tariff_mode"], "package")
        self.assertEqual(self.call("GET", "/reports/history")[0]["tot"], 500)

    def test_package_group_and_missing_package_are_rejected(self):
        self.tariffs()
        for table, package in [("t5", "qa-fixed"), ("t1", "missing")]:
            self.call("POST", "/sessions/start", expected=400, json={"table_id": table, "customer_name": "QA", "rate": 1, "tariff_mode": "package", "package_id": package})
        self.assertEqual(self.call("GET", "/sessions/active"), [])

    def test_frame_lp_allocation_and_stale_frame_protection(self):
        self.tariffs()
        self.start(tariff_mode="frame", billing_mode="lp", players=["Second Player"])
        first = self.call("GET", "/sessions/active")[0]["current_frame"]
        self.call("POST", "/sessions/t1/frames/close", expected=400, json={})
        self.complete_frame(loser="Second Player")
        self.call("POST", "/sessions/t1/frames/start")
        self.call("POST", "/sessions/t1/frames/close", expected=409, json={"frame_id": first["id"], "loser_name": "QA Engine Player"})
        self.complete_frame(loser="QA Engine Player")
        quote = self.quote()
        self.assertEqual({row["name"]: row["total"] for row in quote["player_breakdown"]}, {"QA Engine Player": 80, "Second Player": 80})

    def test_fixed_tariffs_keep_tax_discount_and_sharing(self):
        self.tariffs()
        with SessionLocal() as db:
            db.query(models.Settings).first().gst_percent = 10
            db.commit()
        self.start(tariff_mode="package", package_id="qa-fixed", billing_mode="sharing", players=["Second Player"])
        self.call("POST", "/sessions/t1/food", json={"item": "QA Engine Tea", "qty": 1})
        quote = self.call("GET", "/sessions/quote/t1", params={"discount_type": "rupee", "discount_value": 50})
        self.assertEqual((quote["ply"], quote["gst_amt"], quote["tot"]), (500, 52, 522))
        self.assertEqual(sum(row["total"] for row in quote["player_breakdown"]), 522)
        bill = self.call("POST", "/sessions/stop/t1", params={"session_key": quote["session_key"], "discount_type": "rupee", "discount_value": 50, "discount_reason": "QA"})
        self.assertEqual(bill["tot"], 522)

    def test_tariff_schema_upgrade_defaults_legacy_to_hourly(self):
        self.start()
        with engine.begin() as connection:
            for table, columns in {"settings": ["tariffs_json"], "active_sessions": ["tariff_mode", "tariff_price", "tariff_label", "package_id"], "transactions": ["tariff_mode", "tariff_price", "tariff_label", "package_id", "frame_count"]}.items():
                for column in columns:
                    connection.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
        ensure_runtime_columns()
        ensure_runtime_columns()
        quote = self.quote()
        self.assertEqual(quote["tariff_mode"], "hourly")
        self.assertIsNone(quote["tariff_price"])
        self.assertEqual(self.call("GET", "/settings/tariffs")["packages"], [])

    def test_tariff_export_and_events_use_correct_boundaries(self):
        self.tariffs(packages=[{"id": "qa", "name": 'QA, "Fixed"', "price": 500, "table_group": "any"}])
        with patch("routers.sessions.queue_realtime_event") as event:
            self.start(tariff_mode="package", package_id="qa")
            self.assertEqual(event.call_args.args[1:], ("table.updated", "floor", "live-floor"))
            self.assertEqual(event.call_args.kwargs, {})
        self.call("POST", "/sessions/stop/t1")
        response = self.client.get("/reports/export")
        self.assertEqual(response.status_code, 200)
        row = list(csv.DictReader(io.StringIO(response.text)))[0]
        self.assertEqual((row["Tariff"], row["Unit Price"], row["Package"]), ("package", "500", 'QA, "Fixed"'))

    @unittest.skipUnless(engine.dialect.name == "postgresql", "Row-lock concurrency verified on PostgreSQL in parity CI")
    def test_concurrent_frame_requests_do_not_duplicate_charges(self):
        self.tariffs()
        self.start(tariff_mode="frame")
        self.complete_frame()
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: self.client.post("/sessions/t1/frames/start"), range(8)))
        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual(len({response.json()["frame"]["id"] for response in responses}), 1)
        frame_id = responses[0].json()["frame"]["id"]
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: self.client.post("/sessions/t1/frames/close", json={"frame_id": frame_id}), range(8)))
        self.assertEqual(sum(response.status_code == 200 for response in responses), 1)
        self.assertTrue(all(response.status_code in {200, 400} for response in responses))
        self.assertEqual((self.quote()["ply"], self.quote()["frame_count"]), (160, 2))

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
        self.call("GET", "/sessions/quote/t1", expected=409, params={"closed_at_ms": self.now + 3600_000})
        quote = self.quote()
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

    def test_session_close_rejects_multiple_payment_parts(self):
        self.start()
        self.now += 60 * 60_000
        quote = self.quote()
        self.call("POST", "/sessions/stop/t1", expected=422, params={
            "session_key": quote["session_key"], "payment_split_json": json.dumps([{"method": "Cash", "amount": 1}]),
        })
        bill = self.call("POST", "/sessions/stop/t1", params={
            "session_key": quote["session_key"],
        })
        self.assertEqual(bill["payment_method"], "Cash")
        self.assertEqual(sum(row["amount"] for row in bill["payment_split"]), bill["tot"])

    def test_additive_schema_upgrade_preserves_legacy_rows(self):
        columns = ["started_at", "paused_at", "total_paused_ms", "rate_multiplier", "rate_label"]
        with SessionLocal() as db:
            db.add(models.ActiveSession(table_id="t1", customer_name="QA Legacy Engine", start_time=self.now, rate=320))
            db.commit()
        try:
            with engine.begin() as connection:
                from migrations import downgrade
                downgrade(connection, keep=2)
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

    def test_anonymous_guest_stays_active_and_checks_out_without_member_pollution(self):
        self.start(customer_name=None)
        active = self.call("GET", "/sessions/active")
        self.assertEqual(len(active), 1)
        self.assertIsNone(active[0]["customer_name"])
        self.assertEqual(active[0]["player_type"], "guest")
        self.assertEqual(active[0]["player_count"], 2)
        floor = self.call("GET", "/sessions/live-floor")
        self.assertEqual(floor["tables"][0]["status_key"], "running")
        self.assertEqual(len(self.call("GET", "/reports/closing-report")["open_tables"]), 1)
        self.call("POST", "/sessions/t1/reserve", expected=400, json={"name": "QA Booking", "time": "23:00"})
        self.now += 60 * 60 * 1000
        bill = self.call("POST", "/sessions/stop/t1")
        self.assertIsNone(bill["nm"])
        self.assertEqual(bill["player_type"], "guest")
        self.assertEqual(self.call("GET", "/members"), [])
        top = self.call("GET", "/reports/top-customers")
        self.assertEqual(top["customers"][0]["name"], "Walk-in Guest")
        with SessionLocal() as db:
            self.assertIsNone(db.query(models.Transaction).first().customer_name)

    def test_guest_name_trims_and_limits_without_creating_members(self):
        for table, value, expected in (("t1", "", None), ("t2", "   ", None), ("t3", "  Rahul's group  ", "Rahul's group"), ("t4", "x" * 80, "x" * 80)):
            self.start(table, customer_name=value)
            with SessionLocal() as db:
                self.assertEqual(db.get(models.ActiveSession, table).customer_name, expected)
        self.call("POST", "/sessions/start", expected=422, json={"table_id": "t5", "customer_name": "x" * 81})
        self.call("POST", "/sessions/stop/t3")
        self.assertEqual(self.call("GET", "/members"), [])

    def test_missing_guest_name_is_valid_and_identity_ids_are_validated(self):
        self.call("POST", "/sessions/start", json={"table_id": "t1"})
        self.call("POST", "/sessions/start", expected=422, json={"table_id": "t2", "player_type": "guest", "member_id": "CUS001"})
        self.call("POST", "/sessions/start", expected=422, json={"table_id": "t2", "player_type": "member"})
        self.call("POST", "/sessions/start", expected=404, json={"table_id": "t2", "player_type": "member", "member_id": "missing"})
        self.call("POST", "/sessions/start", expected=422, json={"table_id": "t2", "player_count": 21})

    def test_member_lookup_resolves_phone_and_server_snapshot(self):
        with SessionLocal() as db:
            db.add(models.Member(customer_id="CUSQA", name="QA Vikram Singh", phone="+91 98765 43210"))
            db.commit()
        self.assertEqual(self.call("GET", "/members/search?q=98"), [])
        self.assertEqual(self.call("GET", "/members/search?q=987654")[0]["id"], "CUSQA")
        self.assertEqual(self.call("GET", "/members/search?q=Vik")[0]["phone"], "+91 98765 43210")
        self.start(player_type="member", member_id="CUSQA", customer_name="Forged Name")
        with SessionLocal() as db:
            session = db.get(models.ActiveSession, "t1")
            self.assertEqual((session.member_id, session.customer_name), ("CUSQA", "QA Vikram Singh"))
            db.query(models.Member).first().name = "QA Renamed Member"
            db.commit()
        self.now += 60 * 60 * 1000
        bill = self.call("POST", "/sessions/stop/t1")
        self.assertEqual(bill["nm"], "QA Vikram Singh")
        self.assertEqual(bill["member_id"], "CUSQA")
        with SessionLocal() as db:
            member = db.query(models.Member).first()
            self.assertEqual(member.visits, 1)
            self.assertEqual(member.spent, bill["tot"])

    def test_booked_start_links_once_and_keeps_saved_rate(self):
        from hsr_config import get_ist_now
        booking = self.call("POST", "/bookings", json={"customer_name": "QA Booked Guest", "table_id": "T1", "booking_time": get_ist_now().isoformat()})
        with SessionLocal() as db:
            db.query(models.Settings).first().wr = 999
            db.commit()
        self.assertEqual(self.call("GET", "/bookings/start-options/t1")[0]["id"], booking["id"])
        started = self.start(player_type="booking", booking_id=booking["id"], customer_name="Forged Booking")
        with SessionLocal() as db:
            row = db.get(models.Booking, booking["id"])
            session = db.get(models.ActiveSession, "t1")
            self.assertEqual((row.status, row.session_key), ("completed", started["session_key"]))
            self.assertEqual((session.customer_name, session.rate, session.booking_id), ("QA Booked Guest", 320, booking["id"]))
        self.call("POST", "/sessions/stop/t1")
        self.call("POST", "/sessions/start", expected=409, json={"table_id": "t1", "player_type": "booking", "booking_id": booking["id"]})
        self.call("DELETE", f"/bookings/{booking['id']}", expected=409)
        self.call("POST", f"/bookings/{booking['id']}/restore", expected=409)

    def test_booking_must_match_table_type_and_time_and_not_match_guest_by_name(self):
        from hsr_config import get_ist_now
        from datetime import timedelta
        booking = self.call("POST", "/bookings", json={"customer_name": "QA Distant Guest", "table_id": "T2", "booking_time": (get_ist_now() + timedelta(hours=2)).isoformat()})
        self.assertEqual(self.call("GET", "/bookings/start-options/t2"), [])
        self.call("POST", "/sessions/start", expected=409, json={"table_id": "t2", "player_type": "booking", "booking_id": booking["id"]})
        self.start(customer_name="QA Distant Guest")
        with SessionLocal() as db:
            self.assertEqual(db.get(models.Booking, booking["id"]).status, "booked")

    def test_concurrent_anonymous_start_has_one_success_and_one_conflict(self):
        def start():
            with TestClient(app) as client:
                return client.post("/sessions/start", headers=dict(self.client.headers), json={"table_id": "t1"}).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(lambda _: start(), range(2)))
        self.assertEqual(sorted(statuses), [200, 409])
        with SessionLocal() as db:
            self.assertEqual(db.query(models.ActiveSession).count(), 1)
            self.assertEqual(db.query(models.AuditLog).filter_by(action="session_start").count(), 1)

    def test_staff_actor_and_metadata_only_event(self):
        from realtime import event_broker
        self.client.headers["Authorization"] = f"Bearer {create_token('qa-staff', 'staff')}"
        self.start(customer_name=None)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.AuditLog).filter_by(action="session_start").first().staff, "qa-staff")
            self.assertEqual(db.query(models.SessionEvent).filter_by(event_type="session_started").first().actor, "qa-staff")
        event = event_broker.replay[-1].data()
        self.assertEqual(set(event), {"type", "topic", "resources", "occurred_at"})

    def test_anonymous_pause_transfer_food_and_zero_value_receipt(self):
        self.start(customer_name=None)
        self.call("POST", "/sessions/pause/t1")
        self.call("POST", "/sessions/transfer/t1", json={"target_table_id": "t2"})
        self.call("POST", "/sessions/pause/t2")
        bill = self.call("POST", "/sessions/stop/t2")
        self.assertIsNone(bill["nm"])
        history = self.call("GET", "/reports/history")
        self.assertEqual(len(history), 1)

    def test_session_nickname_is_not_an_extra_sharing_payer(self):
        self.start(customer_name="QA Rahul's group", billing_mode="sharing", players=["QA Rahul", "QA Vikram"])
        self.now += 60 * 60 * 1000
        bill = self.call("POST", "/sessions/stop/t1")
        self.assertEqual(bill["share_count"], 2)
        self.assertEqual(bill["players"], ["QA Rahul", "QA Vikram"])
        self.assertEqual(self.call("GET", "/members"), [])

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
