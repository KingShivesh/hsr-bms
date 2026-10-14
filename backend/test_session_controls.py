"""Session-close controls against the same disposable database parity fixture."""
import json
import unittest
from datetime import datetime

import test_session_engine as fixture
from deps import create_token, hash_password
from deps import SECRET_KEY, ALGORITHM
from jose import jwt
from session_alerts import collect_alerts, collect_weekly_summary
from hsr_config import IST_TZ

models, SessionLocal = fixture.models, fixture.SessionLocal

class SessionControlsTests(unittest.TestCase):
    setUp = fixture.SessionEngineTests.setUp
    tearDown = fixture.SessionEngineTests.tearDown
    call = fixture.SessionEngineTests.call
    quote = fixture.SessionEngineTests.quote

    def start(self, table="t1"):
        return self.call("POST", "/sessions/start", json={"table_id": table})

    def proposal(self, minutes=30, **options):
        self.start()
        self.now += minutes * 60000
        token = create_token("qa-engine", "admin")
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        claims["exp"] = self.now / 1000 + 86400
        self.client.headers["Authorization"] = "Bearer " + jwt.encode(claims, SECRET_KEY, algorithm=ALGORITHM)
        quote = self.quote()
        return {"session_key": quote["session_key"], "closed_at_ms": quote["session_ended_at"], "checkout_token_value": quote["checkout_token"], **options}

    def override(self, minutes=60, **options):
        return {"started_at_ms": self.now - minutes * 60000, "total_paused_minutes": 0, "reason": "staff_forgot_to_start", **options}

    def test_start_has_no_identity_or_member_record(self):
        self.start()
        active = self.call("GET", "/sessions/active")[0]
        self.assertIsNone(active["customer_name"])
        self.assertIsNone(active["member_id"])
        self.assertEqual(active["player_type"], "guest")
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Member).count(), 0)

    def test_staff_can_move_start_before_creation_preview_is_read_only(self):
        body = self.proposal()
        self.client.headers["Authorization"] = f"Bearer {create_token('qa-staff', 'staff')}"
        body["time_override"] = self.override()
        preview = self.call("POST", "/sessions/checkout-preview/t1", json=body)
        self.assertEqual(preview["dur"], 60)
        self.assertEqual(preview["time_edit"]["category"], "correction")
        self.assertTrue(preview["can_edit_time"])
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Transaction).count(), 0)
            self.assertEqual(db.query(models.SessionEvent).filter_by(event_type="session_time_edited").count(), 0)
            self.assertGreater(db.get(models.ActiveSession, "t1").started_at, body["time_override"]["started_at_ms"])
        closed = self.call("POST", "/sessions/stop/t1", json=body)
        self.assertEqual(closed["dur"], 60)
        self.assertEqual(closed["time_edit"]["staff"], "qa-staff")
        with SessionLocal() as db:
            event = db.query(models.SessionEvent).filter_by(event_type="session_time_edited").one()
            self.assertEqual(json.loads(event.payload_json)["original_duration"], 30)
            self.assertEqual(db.query(models.AuditLog).filter_by(action="session_time_edited").count(), 1)

    def test_staff_permission_can_be_revoked_server_side(self):
        body = self.proposal(time_override=self.override())
        with SessionLocal() as db:
            db.query(models.Settings).first().session_controls_json = json.dumps({"allowStaffEditTime": False})
            db.commit()
        self.client.headers["Authorization"] = f"Bearer {create_token('qa-staff', 'staff')}"
        self.call("POST", "/sessions/checkout-preview/t1", expected=403, json=body)
        self.call("POST", "/sessions/stop/t1", expected=403, json=body)

    def test_large_edit_needs_pin_even_when_reset_pin_is_disabled(self):
        body = self.proposal()
        body["time_override"] = self.override(180)
        quote = self.call("POST", "/sessions/checkout-preview/t1", json=body)
        self.assertTrue(quote["pin_required"])
        self.call("POST", "/sessions/stop/t1", expected=409, json=body)
        with SessionLocal() as db:
            security = db.query(models.SecurityControl).first()
            if security is None:
                security = models.SecurityControl()
                db.add(security)
            security.manager_pin_hash = hash_password("2468")
            security.require_pin_for_resets = False
            db.commit()
        body["time_override"]["manager_pin"] = "wrong"
        self.call("POST", "/sessions/stop/t1", expected=403, json=body)
        body["time_override"]["manager_pin"] = "2468"
        self.call("POST", "/sessions/stop/t1", json=body)

    def test_invalid_times_reason_and_pause_rejected(self):
        body = self.proposal()
        for override in [self.override(reason="invented"), self.override(started_at_ms=self.now + 1), self.override(total_paused_minutes=60), self.override(reason="other", notes="")]:
            self.call("POST", "/sessions/checkout-preview/t1", expected=422, json={**body, "time_override": override})

    def test_customer_preview_creates_nothing_and_skip_is_anonymous(self):
        body = self.proposal(customer={"name": "QA Walk-in"})
        self.call("POST", "/sessions/checkout-preview/t1", json=body)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Member).count(), 0)
        body["customer"] = {"name": None}
        receipt = self.call("POST", "/sessions/stop/t1", json=body)
        self.assertIsNone(receipt["nm"])
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Member).count(), 0)

    def test_explicit_member_links_existing_without_downgrade(self):
        with SessionLocal() as db:
            db.add(models.Member(customer_id="CUSQA", name="QA Member", phone="+91 98765 00001", record_type="lp_member"))
            db.commit()
        body = self.proposal(customer={"member_id": "CUSQA", "recalculate_rate": False})
        receipt = self.call("POST", "/sessions/stop/t1", json=body)
        self.assertEqual(receipt["member_id"], "CUSQA")
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Member).count(), 1)
            self.assertEqual(db.query(models.Member).one().record_type, "lp_member")

    def test_phone_only_profile_delete_undo_preserves_type(self):
        with SessionLocal() as db:
            db.add(models.Member(customer_id="CUSQA", name=None, phone="9876500001", record_type="walk_in"))
            db.commit()
        self.call("DELETE", "/members/CUSQA")
        restored = self.call("POST", "/members/CUSQA/restore", json={"name": None, "phone": "9876500001", "record_type": "walk_in"})
        self.assertEqual(restored["record_type"], "walk_in")
        self.assertIsNone(restored["nm"])

    def test_name_only_never_creates_member_record(self):
        body = self.proposal(customer={"name": "QA Name-only"})
        receipt = self.call("POST", "/sessions/stop/t1", json=body)
        self.assertEqual(receipt["nm"], "QA Name-only")
        self.assertEqual(receipt["player_type"], "walk_in")
        self.assertIsNone(receipt["member_id"])
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Member).count(), 0)
        self.start()
        self.now += 60000
        quote = self.quote()
        body.update(session_key=quote["session_key"], closed_at_ms=quote["session_ended_at"], checkout_token_value=quote["checkout_token"])
        self.call("POST", "/sessions/stop/t1", json=body)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Member).count(), 0)

    def test_configured_member_rate_recalculates_from_scratch(self):
        with SessionLocal() as db:
            db.add(models.Member(customer_id="CUSQA", name="QA Member", hourly_rate=240, record_type="lp_member"))
            db.commit()
        body = self.proposal(60, customer={"member_id": "CUSQA", "recalculate_rate": True})
        preview = self.call("POST", "/sessions/checkout-preview/t1", json=body)
        self.assertEqual(preview["rate_delta"], -80)
        receipt = self.call("POST", "/sessions/stop/t1", json=body)
        self.assertEqual(receipt["ply"], 240)
        self.assertEqual(receipt["member_id"], "CUSQA")

    def test_stale_proposal_and_unknown_credit_payment_are_rejected(self):
        body = self.proposal()
        self.call("POST", "/sessions/stop/t1", expected=409, json={**body, "session_key": "stale"})
        self.call("POST", "/sessions/stop/t1", expected=422, json={**body, "payment_method": "Member Credit"})
        receipt = self.call("POST", "/sessions/stop/t1", json=body)
        duplicate = self.call("POST", "/sessions/stop/t1", json=body)
        self.assertEqual(receipt["session_key"], duplicate["session_key"])

    def test_close_has_one_payment_method_only(self):
        body = self.proposal(30)
        for method in ["Card", "Split", "invented"]:
            self.call("POST", "/sessions/stop/t1", expected=422, json={**body, "payment_method": method})
        self.call("POST", "/sessions/stop/t1", expected=422, json={**body, "payment_split": [{"method": "Cash", "amount": 160}]})
        receipt = self.call("POST", "/sessions/stop/t1", json=body)
        self.assertEqual(receipt["tot"], 160)
        self.assertEqual(receipt["payment_method"], "Cash")

    def test_thresholds_are_exact_durable_and_suppressed_while_paused(self):
        self.start()
        with SessionLocal() as db:
            db.query(models.Settings).first().min_session = 120
            db.commit()
        origin = self.now
        collect_alerts(origin + 1799999)
        self.assertEqual(self.call("GET", "/sessions/alerts")["alerts"], [])
        collect_alerts(origin + 1800000)
        rows = self.call("GET", "/sessions/alerts")["alerts"]
        self.assertEqual([row["intensity"] for row in rows], ["subtle"])
        collect_alerts(origin + 1800000)
        self.assertEqual(len(self.call("GET", "/sessions/alerts")["alerts"]), 1)
        self.now = origin + 1800000
        self.call("POST", "/sessions/pause/t1")
        collect_alerts(origin + 7200000)
        self.assertEqual(len(self.call("GET", "/sessions/alerts")["alerts"]), 1)
        self.now = origin + 7200000
        self.call("POST", "/sessions/pause/t1")
        collect_alerts(origin + 9000000)
        rows = self.call("GET", "/sessions/alerts")["alerts"]
        self.assertEqual([row["threshold_minutes"] for row in rows], [30, 60])
        self.call("POST", f"/sessions/alerts/{rows[-1]['id']}/acknowledge")
        self.assertEqual(len(self.call("GET", "/sessions/alerts")["alerts"]), 1)

    def test_overtime_unique_urgent_and_no_auto_end(self):
        self.start()
        collect_alerts(self.now + 180 * 60000)
        collect_alerts(self.now + 180 * 60000)
        rows = self.call("GET", "/sessions/alerts")["alerts"]
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[-1]["alert_type"], "overtime")
        self.assertEqual(rows[-1]["intensity"], "urgent")
        self.assertEqual(len(self.call("GET", "/sessions/active")), 1)

    def test_audit_report_filters_csv_and_late_edit(self):
        body = self.proposal(25 * 60)
        body["time_override"] = self.override(12 * 60, reason="customer_dispute", notes="=QA spreadsheet formula")
        self.call("POST", "/sessions/stop/t1", json=body)
        rows = self.call("GET", "/reports/session-edits?category=adjustment&staff=qa-engine")
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["late_edit"])
        self.assertEqual(self.call("GET", "/reports/session-edits?category=correction"), [])
        response = self.client.get("/reports/session-edits?export=true")
        self.assertEqual(response.status_code, 200)
        self.assertIn("'=QA", response.text)
        self.now -= 25 * 60 * 60000
        self.client.headers["Authorization"] = f"Bearer {create_token('qa-staff', 'staff')}"
        self.call("GET", "/reports/session-edits", expected=403)

    def test_weekly_summary_is_once_and_owner_only(self):
        monday = datetime(2026, 10, 12, 6, tzinfo=IST_TZ).timestamp() * 1000
        with SessionLocal() as db:
            db.add_all([models.Transaction(ts=monday - 86400000, table_id="T1", duration=30, total=100) for _ in range(4)])
            db.add(models.SessionEvent(ts=monday - 86400000, event_type="session_time_edited", session_key="qa-summary", payload_json=json.dumps({"delta": -166, "reason_label": "Customer dispute"})))
            db.commit()
            self.assertEqual(collect_weekly_summary(db, monday), 1)
            db.commit()
            self.assertEqual(collect_weekly_summary(db, monday + 60000), 0)
        summaries = self.call("GET", "/sessions/alerts")["owner_summaries"]
        self.assertEqual(len(summaries), 1)
        self.assertEqual((summaries[0]["count"], summaries[0]["percentage"], summaries[0]["delta"]), (1, 25, -166))
        self.client.headers["Authorization"] = f"Bearer {create_token('qa-staff', 'staff')}"
        self.assertEqual(self.call("GET", "/sessions/alerts")["owner_summaries"], [])
        self.call("POST", "/sessions/weekly-summary/2026-10-12/acknowledge", expected=403)

if __name__ == "__main__":
    unittest.main(verbosity=2)
