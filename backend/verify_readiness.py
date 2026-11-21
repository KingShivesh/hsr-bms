"""Repeatable fresh-install parity checks against disposable local Postgres only."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("--install", action="store_true")
parser.add_argument("--output", required=True)
args = parser.parse_args()
url = os.environ.get("HSR_TEST_DATABASE_URL", "")
parsed = urlsplit(url)
if parsed.hostname not in {"127.0.0.1", "localhost"} or not parsed.path.startswith("/hsr_"):
    raise SystemExit("Only disposable loopback hsr_* PostgreSQL databases are permitted")
if os.environ.get("DATABASE_URL") != url:
    raise SystemExit("DATABASE_URL must match the disposable test URL")
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
report = {"python": sys.version.split()[0], "database": "disposable loopback PostgreSQL", "steps": []}


def run(name, command):
    started = time.monotonic()
    with (output / f"{name}.log").open("w") as handle:
        result = subprocess.run(command, stdout=handle, stderr=subprocess.STDOUT, text=True, timeout=600)
    log = (output / f"{name}.log").read_text()
    row = {"name": name, "status": result.returncode, "seconds": round(time.monotonic() - started, 3)}
    counts = re.findall(r"Ran (\d+) tests?", log)
    if counts:
        row["tests"] = sum(map(int, counts))
    report["steps"].append(row)
    (output / "results.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(row), flush=True)
    if result.returncode:
        print(log[-8000:], flush=True)
        raise SystemExit(result.returncode)


if args.install:
    run("installer", [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--upgrade", "pip>=26.2"])
    run("requirements", [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.txt"])
run("production-import", [sys.executable, "-c", "from main import app; print(app.title)"])
for name in ["database_reliability", "session_engine", "full_stack", "session_controls", "session_food_credit", "identity_migrations", "product_shell", "money_integrity"]:
    run(name, [sys.executable, f"test_{name}.py"])
run("soak", [sys.executable, "soak_test.py", "--database-url", url, "--duration-seconds", "1", "--interval-seconds", "0"])
report["passed"] = True
(output / "results.json").write_text(json.dumps(report, indent=2))
