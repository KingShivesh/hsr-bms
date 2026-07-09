import argparse
import json
import os
from pathlib import Path
from datetime import datetime
from urllib.parse import quote, urlsplit, urlunsplit

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text

import models
from database import Base


RUNTIME_COLUMNS = {
    "settings": {
        "wr": "INTEGER DEFAULT 320",
        "booking_grace_minutes": "INTEGER DEFAULT 10",
    },
    "bookings": {
        "released_at": "VARCHAR DEFAULT ''",
    },
    "active_sessions": {
        "billing_mode": "VARCHAR DEFAULT 'single'",
        "players_json": "TEXT DEFAULT '[]'",
    },
    "transactions": {
        "billing_mode": "VARCHAR DEFAULT 'single'",
        "players_json": "TEXT DEFAULT '[]'",
        "payer_name": "VARCHAR DEFAULT ''",
    },
}


def normalize_postgres_url(url):
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


def build_supabase_url(password):
    encoded_password = quote(password, safe="")
    return (
        "postgresql://postgres.moudnsrorcfzsmbzexcw:"
        f"{encoded_password}@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"
        "?sslmode=require"
    )


def get_target_url(args):
    if args.supabase_url:
        return normalize_postgres_url(args.supabase_url)
    if args.supabase_password:
        return build_supabase_url(args.supabase_password)

    env_url = os.getenv("SUPABASE_DATABASE_URL") or os.getenv("DATABASE_URL", "")
    if env_url.startswith(("postgresql://", "postgres://")):
        return normalize_postgres_url(env_url)

    raise SystemExit(
        "No Supabase URL found. Pass --supabase-password, --supabase-url, "
        "or set SUPABASE_DATABASE_URL."
    )


def ensure_runtime_columns(engine):
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, required_columns in RUNTIME_COLUMNS.items():
            if table not in existing_tables:
                continue
            existing_columns = {
                column["name"]
                for column in inspector.get_columns(table)
            }
            for column, ddl in required_columns.items():
                if column not in existing_columns:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def table_count(engine, table):
    with engine.connect() as conn:
        return conn.execute(
            text(f'SELECT COUNT(*) FROM "{table.name}"')
        ).scalar_one()


def copy_rows(source_engine, target_engine, replace_target):
    Base.metadata.create_all(bind=target_engine)
    ensure_runtime_columns(source_engine)
    ensure_runtime_columns(target_engine)

    tables = list(Base.metadata.sorted_tables)

    if replace_target:
        backup_path = backup_target_rows(target_engine, tables)
        with target_engine.begin() as conn:
            for table in reversed(tables):
                conn.execute(table.delete())
        print(f"Backed up existing Supabase rows to {backup_path}")

    copied = {}
    with source_engine.connect() as source_conn, target_engine.begin() as target_conn:
        for table in tables:
            rows = [
                dict(row)
                for row in source_conn.execute(table.select()).mappings().all()
            ]
            if rows:
                target_conn.execute(table.insert(), rows)
            copied[table.name] = len(rows)

    reset_postgres_sequences(target_engine, tables)
    return copied


def reset_postgres_sequences(engine, tables):
    with engine.begin() as conn:
        for table in tables:
            if "id" not in table.c:
                continue
            conn.execute(
                text(
                    """
                    SELECT setval(
                        pg_get_serial_sequence(:table_name, 'id'),
                        COALESCE((SELECT MAX(id) FROM "%s"), 1),
                        (SELECT MAX(id) IS NOT NULL FROM "%s")
                    )
                    """
                    % (table.name, table.name)
                ),
                {"table_name": table.name},
            )


def backup_target_rows(engine, tables):
    backup = {}
    with engine.connect() as conn:
        for table in tables:
            backup[table.name] = [
                dict(row)
                for row in conn.execute(table.select()).mappings().all()
            ]

    backup_path = (
        Path(__file__).resolve().parent
        / f"supabase_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    backup_path.write_text(json.dumps(backup, indent=2, default=str) + "\n")
    return backup_path


def write_env_database_url(env_path, database_url):
    env_path = Path(env_path)
    lines = env_path.read_text().splitlines() if env_path.exists() else []
    output = []
    replaced = False

    for line in lines:
        if line.startswith("DATABASE_URL="):
            output.append(f"DATABASE_URL={database_url}")
            replaced = True
        else:
            output.append(line)

    if not replaced:
        output.append(f"DATABASE_URL={database_url}")

    env_path.write_text("\n".join(output) + "\n")


def mask_url(url):
    parts = urlsplit(url)
    if not parts.password:
        return url
    username = quote(parts.username or "", safe="")
    netloc = f"{username}:***@{parts.hostname}"
    if parts.port:
        netloc += f":{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def main():
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Copy the local HSR SQLite database into Supabase/Postgres."
    )
    parser.add_argument(
        "--sqlite-url",
        default="sqlite:///./hsr_billiards.db",
        help="Source SQLite SQLAlchemy URL.",
    )
    parser.add_argument(
        "--supabase-url",
        default="",
        help="Target Supabase/Postgres SQLAlchemy URL.",
    )
    parser.add_argument(
        "--supabase-password",
        default="",
        help="Supabase DB password. The script builds the HSR project pooler URL.",
    )
    parser.add_argument(
        "--replace-target",
        action="store_true",
        help="Delete existing target rows before copying local data.",
    )
    parser.add_argument(
        "--write-env",
        action="store_true",
        help="Set backend/.env DATABASE_URL to the Supabase URL after a successful copy.",
    )
    args = parser.parse_args()

    target_url = get_target_url(args)
    source_engine = create_engine(args.sqlite_url, connect_args={"check_same_thread": False})
    target_engine = create_engine(target_url)

    if not args.replace_target:
        Base.metadata.create_all(bind=target_engine)
        non_empty = [
            table.name
            for table in Base.metadata.sorted_tables
            if table_count(target_engine, table) > 0
        ]
        if non_empty:
            raise SystemExit(
                "Supabase already has data in these tables: "
                + ", ".join(non_empty)
                + ". Re-run with --replace-target to overwrite Supabase with local data."
            )

    copied = copy_rows(source_engine, target_engine, args.replace_target)

    if args.write_env:
        write_env_database_url(Path(__file__).with_name(".env"), target_url)

    print("Copied local SQLite data to Supabase:")
    for table, count in copied.items():
        print(f"- {table}: {count}")
    print(f"Target: {mask_url(target_url)}")
    if args.write_env:
        print("Updated backend/.env DATABASE_URL to Supabase.")


if __name__ == "__main__":
    main()
