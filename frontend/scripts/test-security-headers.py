"""Keep the enforcing CSP compatible with the real, unchanged theme bootstrap."""
import base64
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.collect = False
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.collect = "src" not in dict(attrs)
            if self.collect:
                self.scripts.append("")

    def handle_data(self, data):
        if self.collect:
            self.scripts[-1] += data

    def handle_endtag(self, tag):
        if tag == "script":
            self.collect = False


class BrowserSecurityPolicyTests(unittest.TestCase):
    def setUp(self):
        config = json.loads((ROOT / "vercel.json").read_text())
        self.headers = {row["key"].lower(): row["value"] for row in config["headers"][0]["headers"]}
        self.policy = {parts[0]: parts[1:] for directive in self.headers["content-security-policy"].split(";")
                       if (parts := directive.split())}

    def test_basic_browser_headers(self):
        self.assertEqual(self.headers["x-content-type-options"], "nosniff")
        self.assertEqual(self.headers["x-frame-options"], "DENY")
        self.assertEqual(self.headers["referrer-policy"], "no-referrer")
        self.assertEqual(self.headers["permissions-policy"], "camera=(), microphone=(), geolocation=()")

    def test_source_and_built_theme_bootstraps_have_exact_script_hashes(self):
        files = [ROOT / "index.html"]
        if (ROOT / "dist/index.html").exists():
            files.append(ROOT / "dist/index.html")
        for file in files:
            parser = InlineScripts()
            parser.feed(file.read_text())
            self.assertTrue(parser.scripts)
            for script in parser.scripts:
                digest = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
                self.assertIn(f"'sha256-{digest}'", self.policy["script-src"], str(file))

    def test_script_policy_does_not_allow_inline_or_eval(self):
        self.assertIn("'self'", self.policy["script-src"])
        for unsafe in ["'unsafe-inline'", "'unsafe-eval'", "*", "https:"]:
            self.assertNotIn(unsafe, self.policy["script-src"])

    def test_policy_preserves_only_required_resource_origins(self):
        self.assertEqual(self.policy["connect-src"], ["'self'", "https://hsr-bms-backend.onrender.com"])
        self.assertEqual(self.policy["font-src"], ["'self'"])
        for name in ["frame-ancestors", "object-src"]:
            self.assertEqual(self.policy[name], ["'none'"])
        for name in ["base-uri", "form-action"]:
            self.assertEqual(self.policy[name], ["'self'"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
