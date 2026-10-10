"""Security/integrity regressions; never connect this suite to production."""

import json
import os
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from datetime import timedelta
from urllib.parse import urlsplit

test_url = os.getenv("HSR_TEST_DATABASE_URL", "")
temporary = None
if test_url:
    parsed = urlsplit(test_url)
    if parsed.hostname not in {"localhost", "127.0.0.1"} or not parsed.path.startswith("/hsr_"):
        raise RuntimeError("Tests require a disposable loopback hsr_* database")
else:
    temporary = tempfile.TemporaryDirectory(prefix="hsr-full-stack-")
    test_url = f"sqlite:///{temporary.name}/audit.db"
os.environ["DATABASE_URL"] = test_url
os.environ.setdefault("SECRET_KEY", "full-stack-audit-test-secret-with-at-least-32-characters")

from fastapi.testclient import TestClient  # noqa: E402
from database import Base, SessionLocal, engine  # noqa: E402
from deps import hash_password  # noqa: E402
from hsr_config import get_ist_now  # noqa: E402
from main import app  # noqa: E402
from routers.auth import _login_failures  # noqa: E402
from routers import sessions  # noqa: E402
import models  # noqa: E402


class FullStackTests(unittest.TestCase):
    def setUp(self):
        with engine.begin() as connection:
            for table in reversed(Base.metadata.sorted_tables):
                connection.execute(table.delete())
        _login_failures.clear()
        with SessionLocal() as db:
            db.add(models.Settings(id=1, username="admin", password=hash_password("QA admin password"),
                                   staff_username="staff", staff_password=hash_password("QA staff password")))
            db.add(models.MenuItem(name="QA Audit Tea", price=20, available=True))
            db.commit()
        self.client = TestClient(app)
        self.admin = self.login("admin", "QA admin password")
        self.staff = self.login("staff", "QA staff password")
        self.client.headers["Authorization"] = f"Bearer {self.admin}"

    def tearDown(self):
        self.client.close()
        with engine.begin() as connection:
            for table in reversed(Base.metadata.sorted_tables):
                connection.execute(table.delete())

    def login(self, username, password):
        response = self.client.post("/auth/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["token"]

    def test_admin_rotation_revokes_old_token(self):
        response = self.client.post("/auth/change", json={"username": "admin", "password": "QA rotated password"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/auth/me").status_code, 401)
        old_login = self.client.post("/auth/login", json={"username": "admin", "password": "QA admin password"})
        self.assertEqual(old_login.status_code, 401)
        new = self.login("admin", "QA rotated password")
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {new}"}).status_code, 200)
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {self.staff}"}).status_code, 200)

    def test_staff_rotation_revokes_only_staff(self):
        response = self.client.post("/auth/change-staff", json={"username": "staff", "password": "QA rotated staff password"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {self.staff}"}).status_code, 401)
        self.assertEqual(self.client.get("/auth/me").status_code, 200)

    def test_logout_revokes_one_session_not_all(self):
        second = self.login("admin", "QA admin password")
        response = self.client.post("/auth/logout")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get("/auth/me").status_code, 401)
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {second}"}).status_code, 200)

    def test_undo_cannot_create_fictitious_sale(self):
        self.client.headers["Authorization"] = f"Bearer {self.staff}"
        response = self.client.post("/food/orders/900000/restore", json={
            "customer_name": "QA invented customer", "items": [], "total": 900000, "payment_method": "UPI",
        })
        self.assertEqual(response.status_code, 404, response.text)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.FoodOnlyOrder).count(), 0)

    def test_undo_preserves_server_receipt(self):
        self.client.post("/food/order", json={"customer_name": "QA Real Customer", "items": [{"item": "QA Audit Tea", "qty": 2}]})
        original = self.client.get("/food/orders").json()[0]
        self.assertEqual(self.client.delete(f"/food/orders/{original['id']}").status_code, 200)
        self.assertEqual(self.client.get("/food/orders").json(), [])
        self.assertEqual(self.client.get("/reports/closing-report").json()["total_revenue"], 0)
        response = self.client.post(f"/food/orders/{original['id']}/restore", json={
            **original, "total": 999999, "customer_name": "QA Tampered", "payment_method": "UPI",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), original)
        repeated = self.client.post(f"/food/orders/{original['id']}/restore", json=original)
        self.assertEqual(repeated.json(), original)
        self.assertEqual(len(self.client.get("/food/orders").json()), 1)

    def test_admin_dashboard_is_not_staff_accessible(self):
        response = self.client.get("/reports/dashboard", headers={"Authorization": f"Bearer {self.staff}"})
        self.assertEqual(response.status_code, 403, response.text[:500])

    def test_backdated_checkout_cannot_erase_shift(self):
        self.client.post("/sessions/start", json={"table_id": "t1", "customer_name": "QA Audit Player", "rate": 320})
        with SessionLocal() as db:
            row = db.query(models.ActiveSession).first()
            row.start_time -= 4 * 60 * 60_000
            row.started_at = row.start_time
            requested = row.started_at + 60_000
            db.commit()
        response = self.client.post("/sessions/stop/t1", params={"closed_at_ms": requested})
        self.assertEqual(response.status_code, 409, response.text)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.Transaction).count(), 0)
            self.assertEqual(db.query(models.ActiveSession).count(), 1)

    def test_signed_checkout_freezes_and_rejects_tampering(self):
        self.client.post("/sessions/start", json={"table_id": "t1", "customer_name": "QA Audit Player", "rate": 320})
        quote = self.client.get("/sessions/quote/t1").json()
        self.assertIn("checkout_token", quote)
        params = {"closed_at_ms": quote["session_ended_at"], "checkout_token_value": quote["checkout_token"], "session_key": quote["session_key"]}
        altered = self.client.post("/sessions/stop/t1", params={**params, "closed_at_ms": quote["session_ended_at"] - 1})
        self.assertEqual(altered.status_code, 409, altered.text)
        other = self.client.post("/sessions/start", json={"table_id": "t2", "customer_name": "QA Other Player", "rate": 320})
        self.assertEqual(other.status_code, 200)
        self.assertEqual(self.client.post("/sessions/stop/t2", params={k: v for k, v in params.items() if k != "session_key"}).status_code, 409)
        with patch("routers.sessions.time.time", return_value=quote["session_ended_at"] / 1000 + 601):
            self.assertEqual(self.client.post("/sessions/stop/t1", params=params).status_code, 409)
        response = self.client.post("/sessions/stop/t1", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["tot"], quote["tot"])
        self.assertTrue(self.client.post("/sessions/stop/t1", params=params).json()["idempotent"])

    def test_legacy_token_requires_reauthentication(self):
        from jose import jwt
        from deps import SECRET_KEY, ALGORITHM
        token = jwt.encode({"sub": "admin", "role": "admin", "exp": int(time.time() + 1000)}, SECRET_KEY, algorithm=ALGORITHM)
        self.assertEqual(self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code, 401)

    @unittest.skipUnless(engine.dialect.name == "postgresql", "Concurrency requires real PostgreSQL row locks")
    def test_concurrent_food_additions_preserve_all_lines(self):
        self.client.post("/sessions/start", json={"table_id": "t1", "customer_name": "QA Race Player", "rate": 320})
        original = sessions.active_session_for_table
        barrier = Barrier(2)
        def synchronized_read(db, table_id, *, lock=False):
            row = original(db, table_id, lock=lock)
            if not lock:
                barrier.wait(timeout=5)
            return row
        def add(_):
            with TestClient(app) as client:
                return client.post("/sessions/t1/food", headers={"Authorization": f"Bearer {self.staff}"}, json={"item": "QA Audit Tea", "qty": 1})
        with patch("routers.sessions.active_session_for_table", side_effect=synchronized_read):
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(add, range(2)))
        self.assertEqual([r.status_code for r in responses], [200, 200])
        with SessionLocal() as db:
            row = db.query(models.ActiveSession).first()
            self.assertEqual(row.food_total, 40)
            self.assertEqual(len(json.loads(row.food_items)), 2)

    def test_password_validation_applies_to_stored_password(self):
        for password in ["       x", " x      ", "\U0001f680" * 30]:
            response = self.client.post("/auth/change", json={"username": "admin", "password": password})
            self.assertIn(response.status_code, (400, 422), response.text)

    def test_bcrypt_login_never_errors_on_long_input(self):
        response = self.client.post("/auth/login", json={"username": "admin", "password": "a" * 128})
        self.assertEqual(response.status_code, 401, response.text)

    def test_login_limit_cannot_be_bypassed_with_forwarded_header(self):
        statuses = [self.client.post("/auth/login", headers={"X-Forwarded-For": f"192.0.2.{i}"},
                    json={"username": "admin", "password": "QA wrong password"}).status_code for i in range(6)]
        self.assertEqual(statuses, [401, 401, 401, 401, 401, 429])

    def test_production_rejects_seeded_default_credentials(self):
        with SessionLocal() as db:
            settings = db.query(models.Settings).first()
            settings.staff_password = hash_password("staff123")
            db.commit()
        with patch.dict(os.environ, {"APP_ENV": "production"}):
            response = self.client.post("/auth/login", json={"username": "staff", "password": "staff123"})
            self.assertEqual(response.status_code, 401, response.text)
            response = self.client.post("/auth/change", json={"username": "admin", "password": "admin123"})
            self.assertEqual(response.status_code, 422, response.text)

    def test_booking_conflict_and_repeat_cancel(self):
        body = {"customer_name": "QA Booking Player", "booking_time": (get_ist_now() + timedelta(days=1)).isoformat(), "table_id": "T1"}
        response = self.client.post("/bookings", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.post("/bookings", json=body).status_code, 400)
        booking = response.json()["id"]
        self.assertEqual(self.client.delete(f"/bookings/{booking}").status_code, 200)
        self.assertEqual(self.client.delete(f"/bookings/{booking}").status_code, 200)

    def test_public_route_boundary(self):
        failures = []
        checked = 0
        for route_path, operations in app.openapi()["paths"].items():
            if route_path in {"/", "/health", "/ready", "/auth/login"}:
                continue
            import re
            path = re.sub(r"\{([^}]+)\}", lambda m: "t1" if "table" in m[1] else "1", route_path)
            for method in operations:
                if method not in {"get", "post", "put", "patch", "delete"}:
                    continue
                checked += 1
                response = self.client.request(method, path, headers={"Authorization": ""})
                if response.status_code != 401:
                    failures.append((method, route_path, response.status_code))
        self.assertGreater(checked, 80)
        self.assertEqual(failures, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
