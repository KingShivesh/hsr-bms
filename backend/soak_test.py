import argparse
import csv
import os
import random
import tempfile
import time
import traceback
from datetime import datetime, timedelta


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run an HSR BMS soak test against a temporary local database."
    )
    parser.add_argument("--duration-seconds", type=int, default=3600)
    parser.add_argument("--interval-seconds", type=float, default=5)
    parser.add_argument("--db-path", default="")
    return parser.parse_args()


args = parse_args()
db_path = args.db_path or os.path.join(
    tempfile.gettempdir(),
    f"hsr_bms_soak_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db",
)

os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["SECRET_KEY"] = "soak-test-secret"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:5173"

import seed  # noqa: E402,F401 - intentionally seeds the temp database
from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402


TABLES = ["t1", "t2", "t3", "t4", "t5"]
SINGLE_NAMES = [
    "Aarav Sharma",
    "Kabir Mehta",
    "Rohan Iyer",
    "Nikhil Rao",
    "Aditya Kapoor",
]
GROUPS = [
    ["Vivaan Joshi", "Arjun Nair"],
    ["Ishaan Verma", "Dev Malhotra", "Reyansh Sethi"],
    ["Samar Khanna", "Yash Bhatia"],
]
FOODS = [
    ("French Fries", 1, None),
    ("Chicken Nuggets", 2, None),
    ("Coffee", 2, None),
    ("Tea", 3, None),
    ("Plain Maggie", 1, None),
    ("Cigarettes MRP + 3", 1, 20),
]
PAYMENTS = ["Cash", "UPI"]


class SoakFailure(Exception):
    pass


client = TestClient(app)
token = None
metrics = {
    "cycles": 0,
    "requests": 0,
    "sessions_closed": 0,
    "food_orders": 0,
    "waitlist_entries": 0,
    "bookings": 0,
    "expected_errors": 0,
}
failures = []
latencies = []


def request(method, path, expected=200, **kwargs):
    started = time.perf_counter()
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = client.request(method, path, headers=headers, **kwargs)
    elapsed_ms = (time.perf_counter() - started) * 1000
    latencies.append(elapsed_ms)
    metrics["requests"] += 1
    if response.status_code != expected:
        raise SoakFailure(
            f"{method} {path} returned {response.status_code}, "
            f"expected {expected}: {response.text[:300]}"
        )
    return response


def login():
    global token
    response = client.post(
        "/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    if response.status_code != 200:
        raise SoakFailure(f"Login failed: {response.status_code} {response.text}")
    token = response.json()["token"]


def close_all_active():
    active = request("GET", "/sessions/active").json()
    for session in active:
        table = session["table_id"]
        mode = session.get("billing_mode", "single")
        payer = ""
        if mode == "lp":
            payer = (session.get("players") or [session["customer_name"]])[0]
        request(
            "POST",
            f"/sessions/stop/{table}",
            params={"payment_method": "Cash", "payer_name": payer},
        )


def seed_sample_members():
    for name in sorted({*SINGLE_NAMES, *(player for group in GROUPS for player in group)}):
        response = request("POST", "/members", json={"name": name}, expected=200)
        if not response.json().get("id"):
            raise SoakFailure(f"Member creation did not return an id for {name}")


def add_food_to_table(table):
    items = random.sample(FOODS, k=2)
    for item, qty, mrp in items:
        payload = {"item": item, "qty": qty}
        if mrp:
            payload["mrp"] = mrp
        request("POST", f"/sessions/{table}/food", json=payload)


def run_single_session(table):
    name = random.choice(SINGLE_NAMES)
    request(
        "POST",
        "/sessions/start",
        json={
            "table_id": table,
            "customer_name": name,
            "rate": 0,
            "billing_mode": "single",
            "players": [],
        },
    )
    add_food_to_table(table)
    request("POST", f"/sessions/{table}/notes", json={"notes": "Soak test single session"})
    result = request(
        "POST",
        f"/sessions/stop/{table}",
        params={"payment_method": random.choice(PAYMENTS)},
    ).json()
    if result["tot"] <= 0 or result["dur"] <= 0:
        raise SoakFailure(f"Invalid single close totals: {result}")
    metrics["sessions_closed"] += 1


def run_sharing_session(table):
    players = random.choice(GROUPS)
    request(
        "POST",
        "/sessions/start",
        json={
            "table_id": table,
            "customer_name": players[0],
            "rate": 0,
            "billing_mode": "sharing",
            "players": players[1:],
        },
    )
    add_food_to_table(table)
    result = request(
        "POST",
        f"/sessions/stop/{table}",
        params={"payment_method": random.choice(PAYMENTS)},
    ).json()
    if result["billing_mode"] != "sharing" or result["share_count"] < 2:
        raise SoakFailure(f"Invalid sharing close: {result}")
    metrics["sessions_closed"] += 1


def run_lp_session(table):
    players = random.choice(GROUPS[:2])
    request(
        "POST",
        "/sessions/start",
        json={
            "table_id": table,
            "customer_name": players[0],
            "rate": 0,
            "billing_mode": "lp",
            "players": players[1:],
        },
    )
    request("POST", f"/sessions/pause/{table}")
    request("POST", f"/sessions/pause/{table}")
    add_food_to_table(table)
    payer = random.choice(players)
    result = request(
        "POST",
        f"/sessions/stop/{table}",
        params={"payment_method": random.choice(PAYMENTS), "payer_name": payer},
    ).json()
    if result["billing_mode"] != "lp" or result["payer_name"] != payer:
        raise SoakFailure(f"Invalid LP close: {result}")
    metrics["sessions_closed"] += 1


def run_food_only_order():
    payload = {
        "customer_name": random.choice(SINGLE_NAMES),
        "items": [
            {"item": "Coffee", "qty": 2},
            {"item": "Cigarettes MRP + 3", "qty": 1, "mrp": 20},
        ],
    }
    result = request("POST", "/food/order", json=payload).json()
    if result["total"] != 73:
        raise SoakFailure(f"Cigarette MRP+3 calculation changed: {result}")
    metrics["food_orders"] += 1


def run_queue_and_booking():
    queued = request(
        "POST",
        "/waitlist",
        json={
            "customer_name": random.choice(SINGLE_NAMES),
            "phone": "9999999999",
            "party_size": random.randint(1, 4),
            "preferred_type": random.choice(["ANY", "POOL", "SNOOKER"]),
            "notes": "Soak test queue",
        },
    ).json()
    metrics["waitlist_entries"] += 1
    request("POST", f"/waitlist/{queued['id']}/seat", json={"table_id": random.choice(TABLES)})

    booking_time = (datetime.now() + timedelta(minutes=30)).isoformat(timespec="minutes")
    booking = request(
        "POST",
        "/bookings",
        json={
            "customer_name": random.choice(SINGLE_NAMES),
            "phone": "8888888888",
            "table_id": "ANY",
            "table_type": "ANY",
            "booking_time": booking_time,
            "duration_mins": 60,
            "notes": "Soak test booking",
        },
    ).json()
    metrics["bookings"] += 1
    request("DELETE", f"/bookings/{booking['id']}")


def run_expected_validation_checks():
    request(
        "POST",
        "/sessions/start",
        expected=400,
        json={
            "table_id": "t1",
            "customer_name": "Only",
            "rate": 0,
            "billing_mode": "single",
        },
    )
    metrics["expected_errors"] += 1
    request(
        "POST",
        "/food/order",
        expected=400,
        json={
            "customer_name": "Test Customer",
            "items": [{"item": "Cigarettes MRP + 3", "qty": 1}],
        },
    )
    metrics["expected_errors"] += 1


def run_reports():
    endpoints = [
        "/reports/summary",
        "/reports/history",
        "/reports/analytics",
        "/reports/top-customers?period=all",
        "/reports/table-utilization",
        "/reports/closing-report",
        "/reports/closing-insights",
        "/food/orders",
        "/food/stats",
        "/members",
        "/members/duplicates",
        "/settings/rates",
        "/settings/menu",
        "/sessions/active",
        "/bookings",
        "/waitlist",
    ]
    for endpoint in endpoints:
        request("GET", endpoint)
    csv_response = request("GET", "/reports/export?period=all")
    decoded = csv_response.content.decode()
    rows = list(csv.reader(decoded.splitlines()))
    if len(rows) < 2:
        raise SoakFailure("CSV export has no transaction rows")


def run_maintenance_check():
    request("POST", "/sessions/maintenance/t5", json={"reason": "Soak test maintenance"})
    request(
        "POST",
        "/sessions/start",
        expected=400,
        json={
            "table_id": "t5",
            "customer_name": "Maintenance Tester",
            "rate": 0,
            "billing_mode": "single",
        },
    )
    metrics["expected_errors"] += 1
    request("DELETE", "/sessions/maintenance/t5")


def run_cycle():
    close_all_active()
    run_single_session("t1")
    run_sharing_session("t3")
    run_lp_session("t5")
    run_food_only_order()
    run_queue_and_booking()
    run_expected_validation_checks()
    run_maintenance_check()
    run_reports()
    close_all_active()
    metrics["cycles"] += 1


def main():
    started = time.time()
    deadline = started + max(1, args.duration_seconds)
    print(f"SOAK_TEST_DB={db_path}", flush=True)
    login()
    seed_sample_members()

    while time.time() < deadline:
        try:
            run_cycle()
        except Exception as exc:
            failures.append({
                "cycle": metrics["cycles"] + 1,
                "error": str(exc),
                "trace": traceback.format_exc(limit=6),
            })
            print(f"[FAIL] cycle={metrics['cycles'] + 1} {exc}", flush=True)
        if metrics["cycles"] and metrics["cycles"] % 3 == 0:
            print(
                f"[PROGRESS] cycles={metrics['cycles']} "
                f"requests={metrics['requests']} "
                f"sessions={metrics['sessions_closed']} "
                f"failures={len(failures)}",
                flush=True,
            )
        time.sleep(max(0, args.interval_seconds))

    elapsed = time.time() - started
    active_left = request("GET", "/sessions/active").json()
    history = request("GET", "/reports/history").json()
    summary = request("GET", "/reports/summary").json()
    members = request("GET", "/members").json()
    food_orders = request("GET", "/food/orders").json()

    sorted_latencies = sorted(latencies)
    p95 = sorted_latencies[int(len(sorted_latencies) * 0.95)] if sorted_latencies else 0
    avg = sum(latencies) / len(latencies) if latencies else 0

    print("SOAK_TEST_RESULT=PASS" if not failures else "SOAK_TEST_RESULT=FAIL", flush=True)
    print(f"elapsed_seconds={elapsed:.1f}", flush=True)
    print(f"cycles={metrics['cycles']}", flush=True)
    print(f"requests={metrics['requests']}", flush=True)
    print(f"sessions_closed={metrics['sessions_closed']}", flush=True)
    print(f"transactions={len(history)}", flush=True)
    print(f"food_orders={len(food_orders)}", flush=True)
    print(f"members={len(members)}", flush=True)
    print(f"active_sessions_left={len(active_left)}", flush=True)
    print(f"summary_sale={summary.get('sale')}", flush=True)
    print(f"avg_latency_ms={avg:.1f}", flush=True)
    print(f"p95_latency_ms={p95:.1f}", flush=True)
    if failures:
        print("failures:", flush=True)
        for failure in failures[:10]:
            print(f"- cycle {failure['cycle']}: {failure['error']}", flush=True)
            print(failure["trace"], flush=True)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
