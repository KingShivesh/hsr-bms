"""Product-shell metadata must not change sessions, roles or financial data."""
import base64
import json
import struct
import unittest
import zlib
from concurrent.futures import ThreadPoolExecutor

import test_session_engine as fixture
from deps import create_token

models, SessionLocal = fixture.models, fixture.SessionLocal


class ProductShellTests(unittest.TestCase):
    setUp = fixture.SessionEngineTests.setUp
    tearDown = fixture.SessionEngineTests.tearDown
    call = fixture.SessionEngineTests.call

    def body(self, **overrides):
        return {"version": 0, "name": "QA Club", "address": "QA Address", "phone": "+91 9876500001", "gst": "", "upiId": "qa@upi", **overrides}

    def test_read_context_does_not_seed_or_expose_credentials(self):
        data = self.call("GET", "/product/context")
        self.assertEqual(data["version"], 0)
        self.assertNotIn("password", json.dumps(data))
        self.assertNotIn("username", json.dumps(data))
        with SessionLocal() as db:
            self.assertEqual(db.query(models.ClubProfile).count(), 0)
            self.assertEqual(db.query(models.Transaction).count(), 0)

    def test_save_audits_actual_actor_preserves_controls_and_rejects_stale_version(self):
        with SessionLocal() as db:
            db.query(models.Settings).one().session_controls_json = json.dumps({"allowStaffEditTime": False, "overtimeThresholdMinutes": 240})
            db.commit()
        data = self.call("PUT", "/product/profile", json=self.body())
        self.assertEqual((data["version"], data["profile"]["upiId"]), (1, "qa@upi"))
        self.call("PUT", "/product/profile", json=self.body(name="Stale"), expected=409)
        with SessionLocal() as db:
            controls = json.loads(db.query(models.Settings).one().session_controls_json)
            self.assertFalse(controls["allowStaffEditTime"])
            self.assertEqual(controls["overtimeThresholdMinutes"], 240)
            self.assertEqual(db.query(models.AuditLog).filter_by(action="club_profile_updated").one().staff, "qa-engine")
            self.assertEqual(db.query(models.Transaction).count(), 0)

    def test_setup_is_real_and_dismissal_persists(self):
        before = self.call("GET", "/product/setup")
        self.assertEqual([s["id"] for s in before["steps"] if s["done"]], ["menu"])
        self.call("PUT", "/product/profile", json=self.body())
        data = self.call("PATCH", "/product/setup", json={"rates_reviewed": True, "guide_reviewed": True, "team_reviewed": True, "collapsed": True})
        self.assertTrue(all(s["done"] for s in data["steps"]))
        self.call("PATCH", "/product/setup", json={"dismissed": True})
        self.assertTrue(self.call("GET", "/product/setup")["setup"]["dismissed"])
        self.assertEqual(self.call("GET", "/product/context")["profile"]["name"], "QA Club")

    def test_staff_can_read_brand_not_owner_account_or_setup(self):
        self.client.headers["Authorization"] = f"Bearer {create_token('qa-staff', 'staff')}"
        self.call("GET", "/product/context")
        for path in ["/product/account", "/product/setup"]:
            self.call("GET", path, expected=403)
        self.call("PUT", "/product/profile", json=self.body(), expected=403)
        self.call("PATCH", "/product/setup", json={"dismissed": True}, expected=403)
        self.client.headers.clear()
        self.call("GET", "/product/context", expected=401)

    def test_no_fake_plans_quotas_or_invitations(self):
        account = self.call("GET", "/product/account")
        self.assertIsNone(account["subscription"])
        self.assertIsNone(account["quotas"])
        self.assertFalse(account["invitations"])
        self.assertFalse(account["individual_accounts"])
        self.assertEqual([row["role"] for row in account["team"]], ["Owner", "Staff"])
        self.assertEqual(account["tables"], 5)
        self.assertNotIn("password", json.dumps(account))

    def test_reject_invalid_logo_gst_upi_and_unexpected_role_fields(self):
        for values in [{"logo": "https://example.com/x.svg"}, {"logo": "data:image/png;base64," + base64.b64encode(b"bad").decode()}, {"gst": "INVALID"}, {"upiId": "not a payment ID"}, {"role": "admin"}, {"name": "   "}]:
            self.call("PUT", "/product/profile", json=self.body(**values), expected=422)
        with SessionLocal() as db:
            self.assertEqual(db.query(models.ClubProfile).count(), 0)

    def test_simultaneous_saves_have_one_winner(self):
        token = self.client.headers["Authorization"]
        def save(name):
            with fixture.TestClient(fixture.app) as client:
                return client.put("/product/profile", headers={"Authorization": token}, json=self.body(name=name)).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(save, ["QA One", "QA Two"]))
        self.assertEqual(sorted(statuses), [200, 409])

    def test_valid_small_png_persists_and_corrupt_png_is_rejected(self):
        def chunk(kind, data):
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00\x00\xff\x7f\xff")) + chunk(b"IEND", b"")
        logo = "data:image/png;base64," + base64.b64encode(png).decode()
        self.call("PUT", "/product/profile", json=self.body(logo=logo))
        self.assertEqual(self.call("GET", "/product/context")["profile"]["logo"], logo)
        invalid = "data:image/png;base64," + base64.b64encode(png[:-1] + b"x").decode()
        self.call("PUT", "/product/profile", json=self.body(version=1, logo=invalid), expected=422)

    def test_collapsing_new_setup_does_not_make_first_profile_save_stale(self):
        self.call("PATCH", "/product/setup", json={"collapsed": True})
        self.assertEqual(self.call("GET", "/product/context")["version"], 0)
        self.call("PUT", "/product/profile", json=self.body())

    def test_other_payment_setting_edits_are_not_silently_overwritten(self):
        with SessionLocal() as db:
            db.query(models.Settings).one().session_controls_json = json.dumps({"upiId": "other@upi"})
            db.commit()
        self.call("PUT", "/product/profile", json=self.body(), expected=409)
        self.assertEqual(self.call("GET", "/product/context")["profile"]["upiId"], "other@upi")
        self.call("PUT", "/product/profile", json=self.body(previousUpiId="other@upi"))


if __name__ == "__main__":
    unittest.main()
