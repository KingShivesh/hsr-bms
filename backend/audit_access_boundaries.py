"""Read-only API probes against a guarded, disposable local fixture database."""
import argparse
import json
from pathlib import Path

import test_session_engine as fixture
from deps import create_token


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    routes = {
        "/reports/summary": "owner",
        "/reports/dashboard": "owner",
        "/reports/history": "owner",
        "/reports/export": "owner",
        "/reports/top-customers": "owner",
        "/reports/table-utilization": "owner",
        "/reports/reconciliation": "owner",
        "/reports/closing-report": "owner",
        "/reports/closing-insights": "owner",
        "/reports/analytics": "owner",
        "/reports/advanced-analytics": "owner",
        "/reports/session-edits": "owner",
        "/members/": "owner",
        "/members/duplicates": "owner",
        "/operations/security-controls": "owner",
        "/operations/audit-logs": "owner",
        "/staff/roles": "owner",
        "/product/account": "owner",
        "/product/setup": "owner",
        "/sessions/live-floor": "staff",
        "/sessions/active": "staff",
        "/settings/menu": "staff",
        "/settings/rates": "staff",
        "/bookings": "staff",
        "/waitlist": "staff",
        "/members/search?q=QA": "staff",
        "/members/recent": "staff",
        "/product/context": "staff",
    }
    test = fixture.SessionEngineTests()
    test.setUp()
    result = {"scope": "Disposable local database only; no production business requests", "cases": []}
    try:
        for role, name in [("anonymous", ""), ("staff", "qa-staff"), ("admin", "qa-engine")]:
            test.client.headers.pop("Authorization", None)
            if role != "anonymous":
                test.client.headers["Authorization"] = "Bearer " + create_token(name, role)
            for path, audience in routes.items():
                response = test.client.get(path)
                expected = 401 if role == "anonymous" else 403 if role == "staff" and audience == "owner" else 200
                # Record shape/field names, never member, receipt or secret values.
                try:
                    body = response.json()
                except ValueError:
                    body = None
                fields = sorted(body) if isinstance(body, dict) else []
                result["cases"].append({"role": role, "path": path, "expected": expected,
                    "status": response.status_code, "pass": response.status_code == expected, "fields": fields})
        result["failures"] = [row for row in result["cases"] if not row["pass"]]
        result["passed"] = not result["failures"]
    finally:
        test.tearDown()
        result["cleanup"] = "Disposable fixture rows removed"
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2))
    print(json.dumps({"cases": len(result["cases"]), "failures": result["failures"], "cleanup": result["cleanup"]}))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
