"""Seed deterministic local-only table states for visual acceptance testing."""

from __future__ import annotations

import argparse
import json
import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path


DB_PATH = Path(__file__).resolve().parents[2] / "backend" / "hsr_billiards.db"
MARKER = "QA TABLE STATE AUDIT"


def cleanup(connection: sqlite3.Connection) -> None:
    connection.execute("DELETE FROM active_sessions WHERE customer_name LIKE 'QA State %'")
    connection.execute("DELETE FROM table_maintenance WHERE reason = ?", (MARKER,))
    connection.execute("DELETE FROM bookings WHERE notes = ?", (MARKER,))


def add_session(connection: sqlite3.Connection, table_id: str, name: str, minutes: int, paused: bool = False) -> None:
    elapsed_ms = minutes * 60 * 1000
    now_ms = time.time() * 1000
    start_time = now_ms - elapsed_ms
    connection.execute(
        """
        INSERT INTO active_sessions (
          table_id, start_time, customer_name, rate, food_total, food_items,
          paused, elapsed_ms, reservation, notes, split, split_name,
          billing_mode, players_json, session_key
        ) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, NULL, ?, 0, '', 'single', ?, ?)
        """,
        (
            table_id,
            start_time,
            name,
            320 if table_id in {"t1", "t2"} else 270,
            180 if table_id == "t1" else 0,
            int(paused),
            elapsed_ms if paused else 0,
            MARKER,
            json.dumps([name]),
            f"qa-table-state-{table_id}",
        ),
    )


def seed_all_states(connection: sqlite3.Connection) -> None:
    add_session(connection, "t1", "QA State Running", 47)
    add_session(connection, "t2", "QA State Paused", 68, paused=True)
    booking_time = (datetime.now() + timedelta(hours=2)).isoformat(timespec="minutes")
    connection.execute(
        """
        INSERT INTO bookings (
          customer_name, phone, table_id, table_type, booking_time,
          duration_mins, notes, status, created_at, ts, released_at
        ) VALUES (?, '', 'T3', 'SNOOKER', ?, 60, ?, 'booked', ?, ?, '')
        """,
        ("QA State Reserved", booking_time, MARKER, datetime.now().strftime("%d/%m/%Y, %H:%M"), time.time() * 1000),
    )
    connection.execute(
        "INSERT INTO table_maintenance (table_id, reason, since) VALUES ('t4', ?, ?)",
        (MARKER, datetime.now().strftime("%d/%m/%Y, %H:%M")),
    )


def seed_contrast(connection: sqlite3.Connection) -> None:
    add_session(connection, "t1", "QA State Running One", 42)
    add_session(connection, "t2", "QA State Running Two", 96)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["all-states", "contrast", "cleanup"])
    args = parser.parse_args()
    with sqlite3.connect(DB_PATH) as connection:
        cleanup(connection)
        if args.mode != "cleanup" and connection.execute("SELECT COUNT(*) FROM active_sessions").fetchone()[0]:
            raise RuntimeError("Refusing to seed over non-QA local sessions")
        if args.mode == "all-states":
            seed_all_states(connection)
        elif args.mode == "contrast":
            seed_contrast(connection)
        connection.commit()
    print(f"{args.mode}: {DB_PATH}")


if __name__ == "__main__":
    main()
