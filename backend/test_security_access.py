"""Owner boundaries without removing trusted Staff operational permissions."""
import unittest
import base64
import json
import logging
import hashlib
import hmac
import time
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch
import test_session_engine as fixture
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from test_support import TestClient
from main import MAX_REQUEST_BYTES, cors_settings

from database import SessionLocal
from deps import SECRET_KEY, create_token
import models


class SecurityAccessTests(unittest.TestCase):
    setUp = fixture.SessionEngineTests.setUp
    tearDown = fixture.SessionEngineTests.tearDown
    call = fixture.SessionEngineTests.call
    start = fixture.SessionEngineTests.start
    quote = fixture.SessionEngineTests.quote

    def as_staff(self):
        self.client.headers["Authorization"] = "Bearer " + create_token("qa-staff", "staff")

    def legacy_token(self, payload, algorithm="HS256"):
        encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode().rstrip("=")
        # Preserve the legacy compact-JWS format independently of either JWT package.
        message = encode({"typ": "JWT", "alg": algorithm}) + "." + encode(payload)
        digest = hmac.new(SECRET_KEY.encode(), message.encode(), hashlib.sha256 if algorithm == "HS256" else hashlib.sha512).digest()
        return message + "." + base64.urlsafe_b64encode(digest).decode().rstrip("=")

    def test_legacy_hs256_login_token_and_logout_remain_compatible(self):
        token = self.legacy_token({"sub": "qa-engine", "role": "admin", "version": 0,
                                   "jti": "qa-legacy-login", "exp": int(time.time()) + 3600})
        headers = {"Authorization": "Bearer " + token}
        self.assertEqual(self.call("GET", "/auth/me", headers=headers)["username"], "qa-engine")
        self.call("POST", "/auth/logout", headers=headers)
        self.call("GET", "/auth/me", headers=headers, expected=401)

    def test_legacy_checkout_quote_remains_valid_and_idempotent(self):
        self.start(); self.now += 60_000
        quote = self.quote()
        token = self.legacy_token({"purpose": "checkout", "session_key": quote["session_key"],
                                   "closed_at_ms": quote["session_ended_at"], "exp": int(time.time()) + 600})
        body = {"session_key": quote["session_key"], "closed_at_ms": quote["session_ended_at"], "checkout_token_value": token}
        first = self.call("POST", "/sessions/stop/t1", json=body)
        repeated = self.call("POST", "/sessions/stop/t1", json=body)
        self.assertEqual(first["tot"], repeated["tot"])
        self.assertTrue(repeated["idempotent"])
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Transaction).count(), 1)

    def test_token_algorithm_is_not_selected_from_untrusted_header(self):
        token = self.legacy_token({"sub": "qa-engine", "role": "admin", "version": 0,
                                   "jti": "qa-wrong-alg", "exp": int(time.time()) + 3600}, algorithm="HS512")
        self.call("GET", "/auth/me", headers={"Authorization": "Bearer " + token}, expected=401)

    def test_signed_token_without_expiry_is_rejected(self):
        token = self.legacy_token({"sub": "qa-engine", "role": "admin", "version": 0, "jti": "qa-no-expiry"})
        self.call("GET", "/auth/me", headers={"Authorization": "Bearer " + token}, expected=401)

    def test_staff_summary_is_only_operational_counts(self):
        self.start()
        self.as_staff()
        summary = self.call("GET", "/reports/summary")
        self.assertEqual(summary, {"active_tables": 1, "total_tables": 5, "idle_tables": 4, "occupancy": 20})

    def test_staff_cannot_read_owner_reports(self):
        self.as_staff()
        for path in ["/reports/closing-report", "/reports/closing-insights", "/reports/reconciliation",
                     "/reports/dashboard", "/reports/history", "/reports/analytics", "/reports/advanced-analytics",
                     "/reports/session-edits", "/members/", "/operations/audit-logs", "/staff/roles", "/product/account",
                     "/food/stats", "/sessions/history/t1", "/sessions/audit/t1"]:
            with self.subTest(path=path):
                self.call("GET", path, expected=403)

    def test_owner_closing_and_summary_remain_available(self):
        self.assertIn("total_revenue", self.call("GET", "/reports/summary"))
        self.assertIn("payment_breakdown", self.call("GET", "/reports/closing-report"))
        self.assertIn("insights", self.call("GET", "/reports/closing-insights"))
        for path in ["/food/stats", "/sessions/history/t1", "/sessions/audit/t1"]:
            self.call("GET", path)

    def test_staff_events_are_scoped_to_current_session_and_disappear_after_close(self):
        started = self.start()
        key = started["session_key"]
        with SessionLocal() as db:
            for session_key in [key, "qa-closed-session"]:
                db.add(models.SessionEvent(table_id="t1", session_key=session_key, event_type="qa_event",
                    ts=self.now, date="01/01/2026, 12:00:00", payload_json="{}"))
            db.commit()
        self.as_staff()
        events = self.call("GET", "/sessions/events/t1")
        self.assertTrue(events)
        self.assertEqual({row["session_key"] for row in events}, {key})
        self.now += 60_000
        self.call("POST", "/sessions/stop/t1")
        self.assertEqual(self.call("GET", "/sessions/events/t1"), [])

    def test_fixture_rejects_nonlocal_database_before_importing_application(self):
        environment = {**os.environ, "HSR_TEST_DATABASE_URL": "postgresql://qa:qa@example.invalid/hsr_forbidden"}
        result = subprocess.run([sys.executable, "-B", "-c", "import test_security_access"], cwd=Path(__file__).parent,
                                env=environment, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Tests require a disposable loopback", result.stderr)
        self.assertNotIn("OperationalError", result.stderr)

    def test_sensitive_staff_writes_are_rejected_before_any_mutation(self):
        self.as_staff()
        for path in ["/reports/day-close", "/auth/change", "/auth/change-staff", "/settings/rates",
                     "/settings/reset-daily", "/settings/clear-all", "/sessions/reset/t1",
                     "/members/", "/staff/roles", "/operations/security-controls"]:
            with self.subTest(path=path):
                self.call("POST", path, expected=403, json={})
        with SessionLocal() as db:
            self.assertEqual(db.query(models.DayClose).count(), 0)
            self.assertEqual(db.query(models.Member).count(), 0)
            self.assertEqual(db.query(models.MutationReceipt).count(), 0)

    def test_staff_member_lookup_never_returns_member_financials(self):
        with SessionLocal() as db:
            db.add(models.Member(customer_id="CUSSEC", name="QA Security Member", current_balance=150, spent=1000))
            db.commit()
        self.as_staff()
        rows = self.call("GET", "/members/search?q=Security")
        self.assertEqual(len(rows), 1)
        self.assertTrue({"current_balance", "spent", "spt", "notes"}.isdisjoint(rows[0]))

    def test_trusted_staff_time_edit_preview_still_works(self):
        self.start()
        self.now += 60_000
        quote = self.quote()
        self.as_staff()
        preview = self.call("POST", "/sessions/checkout-preview/t1", json={
            "session_key": quote["session_key"], "closed_at_ms": quote["session_ended_at"],
            "checkout_token_value": quote["checkout_token"],
            "time_override": {"started_at_ms": self.now - 120_000, "total_paused_minutes": 0, "reason": "staff_forgot_to_start"},
        })
        self.assertTrue(preview["can_edit_time"])
        self.assertEqual(preview["dur"], 2)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Transaction).count(), 0)

    def test_client_role_header_cannot_override_signed_staff_role(self):
        self.as_staff()
        self.call("GET", "/reports/closing-report", expected=403, headers={"X-Role": "admin"})

    def test_unauthenticated_requests_have_no_report_access(self):
        self.client.headers.pop("Authorization")
        for path in ["/reports/summary", "/reports/closing-report", "/reports/closing-insights"]:
            self.call("GET", path, expected=401)

    def test_qa_request_logs_redact_tokens(self):
        encode = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
        token = ".".join([encode({"alg": "HS256"}), encode({"local": True}), "synthetic-signature"])
        with self.assertLogs("httpx", level="INFO") as captured:
            logging.getLogger("httpx").info("GET %s", "https://testserver/quote?token=" + token)
        self.assertNotIn(token, captured.output[0])
        self.assertIn("[REDACTED_QA_JWT]", captured.output[0])

    def test_production_cors_rejects_unrelated_previews_but_allows_live_app(self):
        with patch.dict(os.environ, {"APP_ENV": "production", "ALLOWED_ORIGINS": "https://*.vercel.app,https://approved.example"}):
            origins, pattern = cors_settings()
        self.assertEqual(origins, ["https://hsr-bms.vercel.app", "https://approved.example"])
        self.assertIsNone(pattern)
        app = FastAPI()
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                           allow_methods=["GET"], allow_headers=["Authorization"])
        with TestClient(app) as client:
            for origin, expected in [("https://hsr-bms.vercel.app", 200), ("https://audit-untrusted.vercel.app", 400)]:
                response = client.options("/", headers={"Origin": origin, "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "authorization"})
                self.assertEqual(response.status_code, expected)
                self.assertNotIn("access-control-allow-credentials", response.headers)

    def test_production_cors_has_no_other_wildcard_fallback(self):
        with patch.dict(os.environ, {"APP_ENV": "production", "ALLOWED_ORIGINS": "https://*.example.com,https://hsr-bms.vercel.app"}):
            origins, pattern = cors_settings()
        self.assertEqual(origins, ["https://hsr-bms.vercel.app"])
        self.assertIsNone(pattern)

    def test_body_limit_covers_content_length_and_chunked_input(self):
        self.start()
        payload = json.dumps({"notes": "x" * MAX_REQUEST_BYTES}).encode()
        for chunked in [False, True]:
            content = (payload[index:index + 8192] for index in range(0, len(payload), 8192)) if chunked else payload
            response = self.client.post("/sessions/t1/notes", content=content, headers={"Content-Type": "application/json"})
            if chunked:
                self.assertNotIn("content-length", response.request.headers)
            self.assertEqual(response.status_code, 413)
            self.assertEqual(response.headers.get("x-content-type-options"), "nosniff")
        with SessionLocal() as db:
            self.assertFalse(db.get(models.ActiveSession, "t1").notes)
        response = self.client.post("/sessions/t1/notes", content=iter([b'{"notes":', b'"QA small note"}']),
                                    headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 200)
        with SessionLocal() as db:
            self.assertEqual(db.get(models.ActiveSession, "t1").notes, "QA small note")


if __name__ == "__main__":
    unittest.main(verbosity=2)
