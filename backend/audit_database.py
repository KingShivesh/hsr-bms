"""Synthetic PostgreSQL/SQLite query and schema evidence. Never use production."""

import argparse
import json
import os
import time
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("--database-url", required=True)
args = parser.parse_args()
parsed = urlsplit(args.database_url)
if parsed.hostname not in {"127.0.0.1", "localhost"} or not parsed.path.startswith("/hsr_"):
    raise RuntimeError("Requires a disposable loopback hsr_* PostgreSQL database")
os.environ["DATABASE_URL"] = args.database_url
os.environ.setdefault("SECRET_KEY", "synthetic-database-audit-secret-with-32-characters")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import event, inspect, text  # noqa: E402
from database import Base, SessionLocal, engine, ensure_runtime_columns  # noqa: E402
from deps import create_token, hash_password  # noqa: E402
from hsr_config import format_ist_now  # noqa: E402
from main import app  # noqa: E402
import models  # noqa: E402

with engine.begin() as conn:
    for table in reversed(Base.metadata.sorted_tables):
        conn.execute(table.delete())
with SessionLocal() as db:
    db.add(models.Settings(id=1, password=hash_password("QA database audit")))
    now = time.time() * 1000
    db.add_all([models.Transaction(date=format_ist_now(), ts=now - i * 60_000, table_id=f"T{i % 5 + 1}",
                 customer_name=f"QA Synthetic {i % 100}", duration=60, play_charge=320, food_charge=0, total=320) for i in range(5000)])
    db.add_all([models.Member(customer_id=f"QA{i}", name=f"QA Synthetic {i}") for i in range(100)])
    db.add_all([models.WaitlistEntry(customer_name=f"QA Queue {i}", status="waiting", ts=now - i * 1000) for i in range(100)])
    db.commit()

statements = []
current_route = ""
@event.listens_for(engine, "before_cursor_execute")
def before(conn, cursor, statement, parameters, context, executemany):
    context.audit_started = time.perf_counter()

@event.listens_for(engine, "after_cursor_execute")
def after(conn, cursor, statement, parameters, context, executemany):
    if current_route:
        statements.append({"route": current_route, "sql": statement, "params": parameters,
                           "duration_ms": (time.perf_counter() - context.audit_started) * 1000})

client = TestClient(app)
client.headers["Authorization"] = f"Bearer {create_token('admin')}"
requests = []
for route in ["/waitlist", "/reports/dashboard", "/reports/analytics", "/reports/history", "/reports/closing-report", "/reports/closing-insights", "/reports/advanced-analytics", "/food/stats", "/members/", "/sessions/live-floor"]:
    current_route = route
    before_count = len(statements)
    started = time.perf_counter()
    response = client.get(route)
    requests.append({"route": route, "status": response.status_code, "duration_ms": round((time.perf_counter() - started) * 1000, 2), "queries": len(statements) - before_count, "response_bytes": len(response.content)})
current_route = ""
unique = {}
for record in statements:
    if record["sql"].lstrip().upper().startswith("SELECT") and "pg_advisory" not in record["sql"]:
        if record["sql"] not in unique or record["duration_ms"] > unique[record["sql"]]["duration_ms"]:
            unique[record["sql"]] = record
plans = []
with engine.connect() as conn:
    for record in sorted(unique.values(), key=lambda r: r["duration_ms"], reverse=True)[:10]:
        result = conn.exec_driver_sql("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + record["sql"], record["params"]).scalar()
        plans.append({"route": record["route"], "query": record["sql"], "observed_ms": round(record["duration_ms"], 3), "plan": result})
    checks = {
        "unknown_active_tables": "SELECT COUNT(*) FROM active_sessions WHERE lower(table_id) NOT IN ('t1','t2','t3','t4','t5')",
        "active_older_than_24h": "SELECT COUNT(*) FROM active_sessions WHERE customer_name <> '' AND start_time < :cutoff",
        "orphan_live_frames": "SELECT COUNT(*) FROM session_frames f WHERE NOT EXISTS (SELECT 1 FROM active_sessions s WHERE lower(s.table_id)=lower(f.table_id) AND s.session_key=f.session_key)",
        "orphan_closed_frames": "SELECT COUNT(*) FROM closed_session_frames f WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id=f.transaction_id)",
        "negative_transactions": "SELECT COUNT(*) FROM transactions WHERE total < 0 OR play_charge < 0 OR food_charge < 0",
        "negative_orders": "SELECT COUNT(*) FROM food_only_orders WHERE total < 0",
        "reversed_closed_timing": "SELECT COUNT(*) FROM transactions WHERE session_started_at > session_ended_at AND session_ended_at > 0",
        "duplicate_transaction_keys": "SELECT COUNT(*) FROM (SELECT session_key FROM transactions WHERE session_key <> '' GROUP BY session_key HAVING COUNT(*) > 1) d",
        "duplicate_customer_ids": "SELECT COUNT(*) FROM (SELECT customer_id FROM members GROUP BY customer_id HAVING COUNT(*) > 1) d",
    }
    integrity = {name: {"sql": query, "count": conn.execute(text(query), {"cutoff": now - 86400_000}).scalar()} for name, query in checks.items()}
    inspector = inspect(conn)
    schema = {name: {"pk": inspector.get_pk_constraint(name), "foreign_keys": inspector.get_foreign_keys(name),
                     "indexes": inspector.get_indexes(name), "checks": inspector.get_check_constraints(name),
                     "columns": [{"name": c["name"], "type": str(c["type"]), "nullable": c["nullable"]} for c in inspector.get_columns(name)]}
              for name in inspector.get_table_names()}
ensure_runtime_columns()
ensure_runtime_columns()
print(json.dumps({"environment": "synthetic local PostgreSQL, NOT production", "rows": {"transactions": 5000, "members": 100, "waitlist": 100}, "requests": requests, "top10_observed_query_plans": plans, "integrity": integrity, "schema": schema, "migration_rerun": "passed twice"}, indent=2))
client.close()
with engine.begin() as conn:
    for table in reversed(Base.metadata.sorted_tables):
        conn.execute(table.delete())
