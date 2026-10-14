"""Order visibility and atomic credit checkout, only on disposable local databases."""
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from test_session_controls import SessionControlsTests
from database import SessionLocal
from realtime import event_broker
import models

class SessionFoodCreditTests(unittest.TestCase):
    setUp = SessionControlsTests.setUp
    tearDown = SessionControlsTests.tearDown
    call = SessionControlsTests.call
    quote = SessionControlsTests.quote
    start = SessionControlsTests.start
    proposal = SessionControlsTests.proposal
    override = SessionControlsTests.override

    def member(self):
        with SessionLocal() as db:
            db.add(models.Member(customer_id="CUSQA", name="QA Credit Member", hourly_rate=240))
            db.commit()

    def test_food_add_serve_modify_cancel_and_initial_payload(self):
        self.start()
        added = self.call("POST", "/sessions/t1/food", json={"item": "QA Engine Tea", "qty": 2})
        key = self.quote()["session_key"]
        order = added["item"]["id"]
        def active():
            return self.call("GET", "/sessions/live-floor")["floor"]["tables"][0]["session"]
        self.assertEqual(active()["canteen_items"][0], {"id": order, "name": "QA Engine Tea", "quantity": 2, "served": False})
        self.assertEqual(active()["canteen_total"], 40)
        self.call("PATCH", f"/sessions/t1/food/{order}", json={"session_key": key, "served": True})
        self.assertTrue(active()["canteen_items"][0]["served"])
        self.call("PATCH", f"/sessions/t1/food/{order}", json={"session_key": key, "quantity": 3})
        self.assertEqual(active()["canteen_total"], 60)
        self.call("DELETE", f"/sessions/t1/food/{order}?session_key={key}")
        self.assertEqual(active()["canteen_items"], [])
        self.assertEqual(active()["canteen_total"], 0)
        self.call("DELETE", f"/sessions/t1/food/{order}?session_key={key}")
        self.now += 60000
        receipt = self.call("POST", "/sessions/stop/t1")
        self.assertEqual(receipt["famt"], 0)
        with SessionLocal() as db:
            self.assertEqual(json.loads(db.query(models.Transaction).one().food_json), [])
            self.assertEqual(db.query(models.SessionEvent).filter_by(event_type="food_cancelled").count(), 1)

    def test_food_uses_original_price_and_stale_session_guard(self):
        self.start()
        order = self.call("POST", "/sessions/t1/food", json={"item": "QA Engine Tea", "qty": 2})["item"]["id"]
        key = self.quote()["session_key"]
        with SessionLocal() as db:
            db.query(models.MenuItem).one().price = 999
            db.commit()
        self.call("PATCH", f"/sessions/t1/food/{order}", json={"session_key": key, "quantity": 3})
        self.assertEqual(self.quote()["famt"], 60)
        self.call("PATCH", f"/sessions/t1/food/{order}", expected=409, json={"session_key": "stale", "served": True})
        self.call("POST", "/sessions/t1/food", expected=409, json={"session_key": "stale", "item": "QA Engine Tea", "qty": 1})

    def test_legacy_order_lines_get_stable_ids_without_repricing(self):
        self.start()
        with SessionLocal() as db:
            sess = db.get(models.ActiveSession, "t1")
            sess.food_items = json.dumps([{"item": "QA Old Tea", "qty": 2, "price": 40}]); sess.food_total = 40
            db.commit()
        key = self.quote()["session_key"]
        self.call("PATCH", "/sessions/t1/food/legacy-0", json={"session_key": key, "served": True})
        self.call("PATCH", "/sessions/t1/food/legacy-0", json={"session_key": key, "quantity": 3})
        self.assertEqual(self.quote()["famt"], 60)

    def test_food_events_are_post_commit_metadata_only_and_rejections_emit_nothing(self):
        self.start()
        sequence = event_broker.sequence
        self.call("POST", "/sessions/t1/food", expected=404, json={"item": "Missing", "qty": 1})
        self.assertEqual(event_broker.sequence, sequence)
        added = self.call("POST", "/sessions/t1/food", json={"item": "QA Engine Tea", "qty": 1})
        events = [e for e in event_broker.replay if int(e.id.split(":")[-1]) > sequence]
        self.assertEqual([e.type for e in events], ["session.orders.updated", "table.updated"])
        for event in events:
            self.assertEqual(set(event.data()), {"type", "topic", "resources", "occurred_at"})
        with SessionLocal() as db:
            self.assertIn(added["item"]["id"], db.get(models.ActiveSession, "t1").food_items)

    def test_phone_and_unknown_fields_are_rejected_no_profile_created(self):
        body = self.proposal()
        self.call("POST", "/sessions/stop/t1", expected=422, json={**body, "customer": {"name": "QA", "phone": "9876500001"}})
        self.call("POST", "/sessions/stop/t1", expected=422, json={**body, "playerPhone": "9876500001"})
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Member).count(), 0)

    def test_credit_requires_member_even_direct_requests(self):
        body = self.proposal(payment_method="Credit", customer={"name": "QA Name"})
        self.call("POST", "/sessions/checkout-preview/t1", expected=422, json=body)
        self.call("POST", "/sessions/stop/t1", expected=422, json=body)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Transaction).count(), 0)
            self.assertEqual(db.query(models.CreditLedger).count(), 0)

    def test_credit_debit_and_balance_are_atomic_idempotent_and_not_cash(self):
        self.member()
        body = self.proposal(60, payment_method="Credit", customer={"member_id": "CUSQA"})
        self.call("POST", "/sessions/checkout-preview/t1", json=body)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.CreditLedger).count(), 0)
            self.assertEqual(db.query(models.Member).one().current_balance, 0)
        receipt = self.call("POST", "/sessions/stop/t1", json=body)
        repeated = self.call("POST", "/sessions/stop/t1", json=body)
        self.assertEqual(receipt["payment_status"], "credit")
        self.assertEqual(receipt["tot"], 240)
        self.assertTrue(repeated["idempotent"])
        with SessionLocal() as db:
            self.assertEqual(db.query(models.CreditLedger).count(), 1)
            self.assertEqual(db.query(models.Payment).count(), 0)
            self.assertEqual(db.query(models.Member).one().current_balance, 240)
        report = self.call("GET", "/reports/closing-report")
        self.assertEqual(report["cash_total"], 0)
        self.assertEqual(report["credit_total"], 240)
        self.call("DELETE", "/members/CUSQA", expected=409)
        self.call("POST", "/settings/reset-daily", expected=409)
        self.call("POST", "/settings/clear-all", expected=409)

    def test_cash_and_upi_create_payments_not_credit_and_reference_saved(self):
        for method in ["Cash", "UPI"]:
            body = self.proposal(30, payment_method=method, payment_reference="QA-UPI-001")
            receipt = self.call("POST", "/sessions/stop/t1", json=body)
            self.assertEqual(receipt["payment_status"], "paid")
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Payment).count(), 2)
            self.assertEqual(db.query(models.CreditLedger).count(), 0)
            upi = db.query(models.Payment).filter_by(method="UPI").one()
            self.assertEqual(upi.reference, "QA-UPI-001")

    def test_credit_rolls_back_balance_and_payment_on_close_failure(self):
        self.member()
        body = self.proposal(payment_method="Credit", customer={"member_id": "CUSQA"})
        with patch("routers.sessions.archive_closed_frames", side_effect=RuntimeError("QA intentional failure")):
            self.call("POST", "/sessions/stop/t1", expected=500, json=body)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Member).one().current_balance, 0)
            self.assertEqual(db.query(models.CreditLedger).count(), 0)
            self.assertEqual(db.query(models.Transaction).count(), 0)
            self.assertIsNotNone(db.get(models.ActiveSession, "t1"))

    def test_time_override_and_alerts_still_apply_to_credit_close(self):
        self.member()
        body = self.proposal(payment_method="Credit", customer={"member_id": "CUSQA"})
        body["time_override"] = self.override(60)
        receipt = self.call("POST", "/sessions/stop/t1", json=body)
        self.assertEqual(receipt["dur"], 60)
        self.assertEqual(receipt["tot"], 240)
        self.assertIsNotNone(receipt["time_edit"])

    def test_remote_order_change_requires_review_before_payment(self):
        body = self.proposal()
        body["expected_total"] = self.quote()["tot"]
        self.call("POST", "/sessions/t1/food", json={"item": "QA Engine Tea", "qty": 1})
        self.call("POST", "/sessions/stop/t1", expected=409, json=body)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Payment).count(), 0)
            self.assertIsNotNone(db.get(models.ActiveSession, "t1"))

    def test_concurrent_credit_close_records_one_debit(self):
        self.member()
        body = self.proposal(60, payment_method="Credit", customer={"member_id": "CUSQA"})
        with ThreadPoolExecutor(max_workers=2) as pool:
            receipts = list(pool.map(lambda _: self.call("POST", "/sessions/stop/t1", json=body), range(2)))
        self.assertEqual(sum(bool(row["idempotent"]) for row in receipts), 1)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.CreditLedger).count(), 1)
            self.assertEqual(db.query(models.Payment).count(), 0)
            self.assertEqual(db.query(models.Member).one().current_balance, 240)

if __name__ == "__main__":
    unittest.main(verbosity=2)
