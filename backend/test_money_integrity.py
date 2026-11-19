"""Money safety regressions using only the guarded disposable fixture database."""
import json
import unittest
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import test_session_engine as fixtures
from database import SessionLocal
from hsr_config import IST_TZ
from money import business_date, day_rows
from reconciliation import reconcile_day
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
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

    def receipt(self, when=None, **changes):
        when = when or datetime.now(IST_TZ)
        data = dict(date=when.strftime("%d/%m/%Y, %H:%M:%S"), ts=when.timestamp() * 1000,
            table_id="T1", customer_name="QA Money", duration=60, play_charge=100,
            food_charge=0, gst_amt=0, total=100, payment_method="Cash", payment_status="paid")
        data.update(changes)
        with SessionLocal() as db:
            row = models.Transaction(**data)
            db.add(row); db.commit()
            return row.id

    def test_three_am_exact_boundary_month_year_and_utc(self):
        self.assertEqual(business_date(datetime(2027, 1, 1, 2, 59, 59)), "31/12/2026")
        self.assertEqual(business_date(datetime(2027, 1, 1, 3)), "01/01/2027")
        self.assertEqual(business_date(datetime(2026, 12, 31, 21, 29, 59, tzinfo=timezone.utc)), "31/12/2026")
        self.assertEqual(business_date(datetime(2026, 12, 31, 21, 30, tzinfo=timezone.utc)), "01/01/2027")

    def test_epoch_and_legacy_receipts_use_same_half_open_window(self):
        self.receipt(datetime(2026, 11, 20, 2, 59, 59, tzinfo=IST_TZ))
        self.receipt(datetime(2026, 11, 20, 3, tzinfo=IST_TZ))
        self.receipt(datetime(2026, 11, 20, 1, tzinfo=IST_TZ), ts=0)
        with SessionLocal() as db:
            rows = day_rows(db, models.Transaction, "19/11/2026")
            self.assertEqual(len(rows), 2)
            self.assertTrue(all(row.date.startswith("20/11/2026") for row in rows))
            self.assertEqual(len(day_rows(db, models.Transaction, "20/11/2026")), 1)

    def test_dashboard_summary_analytics_and_closing_share_business_day(self):
        self.receipt(datetime(2027, 1, 1, 2, 59, tzinfo=IST_TZ))
        self.receipt(datetime(2027, 1, 1, 3, tzinfo=IST_TZ), total=200, play_charge=200)
        with patch("hsr_config.get_ist_now", return_value=datetime(2027, 1, 1, 2, 59)), \
             patch("routers.reports.get_ist_now", return_value=datetime(2027, 1, 1, 2, 59)):
            closing = self.call("GET", "/reports/closing-report")
            summary = self.call("GET", "/reports/summary")
            analytics = self.call("GET", "/reports/analytics")
            customers = self.call("GET", "/reports/top-customers?period=month")
            self.assertEqual(self.call("GET", "/reports/top-customers?period=week")["label"], "Last 7 days")
        self.assertEqual(closing["total_revenue"], 100)
        self.assertEqual(summary["sale"], 100)
        self.assertEqual(sum(row["revenue"] for row in analytics["weekly"]), 100)
        self.assertEqual(customers["label"], "December 2026")

    def test_close_is_immutable_and_blocks_new_money_and_historical_cancel(self):
        first = self.counter("qa-close-original-0001").json()
        day = self.call("GET", "/reports/closing-report")["date"]
        result = self.call("POST", "/reports/day-close", json={"business_date": day, "opened_float": 100, "counted_cash": 115})
        self.assertEqual(result["expected_cash"], 20)
        self.assertEqual(result["variance"], -5)
        self.assertEqual(self.counter("qa-close-new-sale-001").status_code, 409)
        self.assertEqual(self.counter("qa-close-original-0001").status_code, 200)
        self.call("POST", "/sessions/start", expected=409, json={"table_id": "t1"})
        self.call("POST", "/reports/day-close", expected=409, json={"business_date": day})
        with SessionLocal() as db:
            order = db.query(models.FoodOnlyOrder).one()
            order_id = order.id; order.total = 999
            db.commit()
        self.call("DELETE", f"/food/orders/{order_id}", expected=409)
        saved = self.call("GET", f"/reports/closing-report?day={day}")
        self.assertEqual(saved["cash_total"], 20)
        self.assertTrue(saved["day_close"]["closed"])
        self.assertFalse(self.call("GET", f"/reports/reconciliation?day={day}")["ok"])
        self.assertTrue(first)

    def test_close_viewed_previous_day_after_boundary_and_reject_future(self):
        with patch("hsr_config.get_ist_now", return_value=datetime(2026, 11, 20, 3, 1)):
            result = self.call("POST", "/reports/day-close", json={"business_date": "19/11/2026"})
            self.assertEqual(result["date"], "19/11/2026")
            self.call("POST", "/reports/day-close", expected=422, json={"business_date": "21/11/2026"})
            self.assertEqual(self.counter("qa-next-business-0001").status_code, 200)

    def test_legacy_payment_gap_needs_explicit_review_never_fabricates_ledger(self):
        self.receipt()
        report = self.call("GET", "/reports/closing-report")
        self.assertTrue(report["reconciliation"]["ok"])
        self.assertEqual(report["reconciliation"]["warnings"][0]["code"], "missing_payment")
        self.call("POST", "/reports/day-close", expected=409, json={})
        self.call("POST", "/reports/day-close", json={"acknowledge_legacy": True})
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Payment).count(), 0)

    def test_fresh_checkout_requires_matching_payment_and_blocks_close(self):
        self.start(); self.now += 60_000
        self.call("POST", "/sessions/stop/t1")
        self.assertTrue(self.call("GET", "/reports/reconciliation")["ok"])
        with SessionLocal() as db:
            db.query(models.Payment).delete(); db.commit()
        report = self.call("GET", "/reports/reconciliation")
        self.assertIn("missing_payment", [row["code"] for row in report["errors"]])
        self.call("POST", "/reports/day-close", expected=409, json={"acknowledge_legacy": True})

    def test_historical_split_reconciles_but_bad_split_never_defaults_to_cash(self):
        tid = self.receipt(payment_split_json=json.dumps([{"method": "Cash", "amount": 40}, {"method": "UPI", "amount": 60}]))
        with SessionLocal() as db:
            result = reconcile_day(db)
            self.assertEqual(result["payment_breakdown"], {"Cash": 40, "UPI": 60, "Card": 0, "Credit": 0})
            row = db.get(models.Transaction, tid)
            row.payment_split_json = '[{"method":"Cash","amount":99}]'
            db.commit()
            result = reconcile_day(db)
            self.assertFalse(result["ok"])
            self.assertEqual(result["payment_breakdown"]["Cash"], 0)

    def test_credit_running_balance_and_member_balance_are_checked(self):
        tid = self.receipt(payment_method="Credit", payment_status="credit", member_id="CUSMONEY")
        with SessionLocal() as db:
            db.add(models.Member(customer_id="CUSMONEY", name="QA Money", current_balance=100)); db.flush()
            db.add(models.CreditLedger(transaction_id=tid, member_id="CUSMONEY", amount=100,
                balance_after=100, entry_type="debit", actor="qa-engine", created_at=self.now))
            db.commit()
            result = reconcile_day(db)
            self.assertTrue(result["ok"], result)
            self.assertEqual(result["collected_total"], 0)
            self.assertEqual(result["credit_total"], 100)
            db.query(models.CreditLedger).one().balance_after = 90
            db.query(models.Member).filter_by(customer_id="CUSMONEY").one().current_balance = 90
            db.commit()
            codes = [row["code"] for row in reconcile_day(db)["errors"]]
            self.assertIn("member_balance_mismatch", codes)
            self.assertIn("credit_running_balance_mismatch", codes)

    def test_commit_failure_rolls_back_order_and_durable_intent(self):
        from realtime import event_broker
        sequence = event_broker.sequence
        with patch.object(Session, "commit", side_effect=RuntimeError("QA forced commit failure")):
            self.assertEqual(self.counter("qa-rollback-order-001").status_code, 500)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.FoodOnlyOrder).count(), 0)
            self.assertEqual(db.query(models.MutationReceipt).count(), 0)
        self.assertEqual(event_broker.sequence, sequence)
        self.assertEqual(self.counter("qa-rollback-order-001").status_code, 200)

    def test_concurrent_same_intent_only_commits_once(self):
        with ThreadPoolExecutor(max_workers=5) as pool:
            responses = list(pool.map(lambda _: self.counter("qa-concurrent-order-01"), range(5)))
        self.assertTrue(all(row.status_code == 200 for row in responses), [row.text for row in responses])
        with SessionLocal() as db:
            self.assertEqual(db.query(models.FoodOnlyOrder).count(), 1)
            self.assertEqual(db.query(models.MutationReceipt).count(), 1)

    def test_close_and_sale_share_one_serialized_snapshot(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            sale = pool.submit(self.counter, "qa-closing-race-00001")
            closing = pool.submit(self.client.post, "/reports/day-close", json={})
            sale, closing = sale.result(), closing.result()
        self.assertEqual(closing.status_code, 200, closing.text)
        self.assertIn(sale.status_code, [200, 409])
        report = self.call("GET", "/reports/closing-report")
        self.assertEqual(report["cash_total"], 20 if sale.status_code == 200 else 0)

    def test_foreign_keys_and_unique_payment_are_enforced(self):
        with SessionLocal() as db:
            db.add(models.Payment(transaction_id=999999, method="Cash", amount=10, created_at=self.now))
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()
        tid = self.receipt()
        with SessionLocal() as db:
            db.add(models.Payment(transaction_id=tid, method="Cash", amount=100, created_at=self.now)); db.commit()
            db.add(models.Payment(transaction_id=tid, method="Cash", amount=100, created_at=self.now))
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()

    def test_staff_cannot_access_reconciliation_or_close(self):
        from deps import create_token
        self.client.headers["Authorization"] = f"Bearer {create_token('qa-staff', 'staff')}"
        self.call("GET", "/reports/reconciliation", expected=403)
        self.call("POST", "/reports/day-close", expected=403, json={})

    def test_all_table_tiers_ceil_partial_minutes_and_apply_minimum(self):
        for table, expected_rate in [("t1", 320), ("t3", 270), ("t5", 170)]:
            self.start(table)
            self.now += 60_001
            quote = self.quote(table)
            self.assertEqual(quote["dur"], 2)
            self.assertEqual(quote["ply"], round(2 * expected_rate / 60))
            self.call("POST", f"/sessions/stop/{table}")
        with SessionLocal() as db:
            db.query(models.Settings).one().min_session = 5; db.commit()
        self.start(); self.now += 1
        self.assertEqual(self.quote()["dur"], 5)
        self.assertEqual(self.quote()["ply"], 27)

    def test_whole_rupee_half_even_policy_and_tax_are_explicit(self):
        from pricing import calc_checkout, calc_gst
        with SessionLocal() as db:
            self.assertEqual(calc_checkout(db, minutes=1, hourly_rate=150, food_total=0)["total"], 2)
            self.assertEqual(calc_checkout(db, minutes=1, hourly_rate=210, food_total=0)["total"], 4)
        self.assertEqual(calc_gst(5, 50), 2)
        self.assertEqual(calc_gst(5, 70), 4)

    def test_incomplete_receipt_is_visible_as_a_blocker_not_a_server_error(self):
        self.receipt(total=None)
        report = self.call("GET", "/reports/closing-report")
        self.assertFalse(report["can_close_day"])
        self.assertIn("invalid_receipt_amount", [row["code"] for row in report["reconciliation"]["errors"]])

    def test_missing_request_key_fails_closed_without_an_order(self):
        response = self.counter("")
        self.assertEqual(response.status_code, 428)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.FoodOnlyOrder).count(), 0)

    def test_reset_cannot_erase_new_audited_receipts(self):
        self.start(); self.now += 60_000
        self.call("POST", "/sessions/stop/t1")
        self.call("POST", "/settings/reset-daily", expected=409)
        self.call("POST", "/settings/clear-all", expected=409)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Transaction).count(), 1)
            self.assertEqual(db.query(models.Payment).count(), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
