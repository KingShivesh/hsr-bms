"""Money safety regressions using only the guarded disposable fixture database."""
import json
import unittest
from datetime import datetime
from unittest.mock import patch

import test_session_engine as fixtures
from database import SessionLocal
from hsr_config import IST_TZ
import models


class MoneyIntegrityTests(unittest.TestCase):
    setUp = fixtures.SessionEngineTests.setUp
    tearDown = fixtures.SessionEngineTests.tearDown
    call = fixtures.SessionEngineTests.call
    start = fixtures.SessionEngineTests.start
    quote = fixtures.SessionEngineTests.quote

    def counter(self, key, **changes):
        return self.client.post("/food/order", headers={"Idempotency-Key": key}, json={
            "customer_name": "QA Money Guest", "items": [{"item": "QA Engine Tea", "qty": 1}],
            "payment_method": "Cash", **changes,
        })

    def test_counter_duplicate_intent_is_one_order(self):
        responses = [self.counter("qa-counter-repeat-0001") for _ in range(5)]
        self.assertTrue(all(row.status_code == 200 for row in responses))
        with SessionLocal() as db:
            self.assertEqual(db.query(models.FoodOnlyOrder).count(), 1)

    def test_same_key_changed_payload_is_rejected(self):
        self.assertEqual(self.counter("qa-counter-conflict-01").status_code, 200)
        second = self.counter("qa-counter-conflict-01", payment_method="UPI")
        self.assertEqual(second.status_code, 409, second.text)

    def test_unknown_payment_is_not_silently_cash(self):
        response = self.counter("qa-counter-invalid-01", payment_method="Not a payment")
        self.assertEqual(response.status_code, 422, response.text)

    def test_pause_retry_keeps_the_requested_state(self):
        started = self.start()
        body = {"session_key": started["session_key"], "paused": True}
        for _ in range(2):
            response = self.client.post("/sessions/pause/t1", headers={"Idempotency-Key": "qa-pause-repeat-00001"}, json=body)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.json()["paused"])

    def test_two_am_closing_uses_previous_business_date(self):
        with patch("hsr_config.get_ist_now", return_value=datetime(2026, 11, 20, 2)):
            report = self.call("GET", "/reports/closing-report")
        self.assertEqual(report["date"], "19/11/2026")

    def test_table_cart_is_atomic_on_invalid_second_item(self):
        started = self.start()
        body = {"session_key": started["session_key"], "items": [
            {"item": "QA Engine Tea", "qty": 1}, {"item": "QA Missing Item", "qty": 1},
        ]}
        response = self.client.post("/sessions/t1/food-order", headers={"Idempotency-Key": "qa-table-cart-bad-001"}, json=body)
        self.assertEqual(response.status_code, 404)
        with SessionLocal() as db:
            session = db.get(models.ActiveSession, "t1")
            self.assertEqual(session.food_total, 0)
            self.assertEqual(json.loads(session.food_items), [])

    def test_table_cart_replay_does_not_add_lines_twice(self):
        started = self.start()
        body = {"session_key": started["session_key"], "items": [{"item": "QA Engine Tea", "qty": 2}]}
        for _ in range(2):
            response = self.client.post("/sessions/t1/food-order", headers={"Idempotency-Key": "qa-table-cart-good-01"}, json=body)
            self.assertEqual(response.status_code, 200, response.text)
        with SessionLocal() as db:
            session = db.get(models.ActiveSession, "t1")
            self.assertEqual(session.food_total, 40)
            self.assertEqual(len(json.loads(session.food_items)), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
