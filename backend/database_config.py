"""Connection configuration without importing the application or touching data."""

from sqlalchemy.engine import make_url

from hsr_config import is_production_env


def database_config(environ):
    raw = (environ.get("DATABASE_URL") or "").strip()
    url = make_url(raw if raw else "sqlite:///./hsr_billiards.db")
    if url.drivername == "postgres":
        url = url.set(drivername="postgresql")
    if is_production_env(environ) and (not raw or url.get_backend_name() != "postgresql"):
        raise RuntimeError("Production requires a PostgreSQL DATABASE_URL; SQLite fallback is disabled.")
    sqlite = url.get_backend_name() == "sqlite"
    if url.drivername == "postgresql":
        url = url.set(drivername="postgresql+psycopg")
    options = {"pool_pre_ping": True, "connect_args": {"check_same_thread": False} if sqlite else {"connect_timeout": 5}}
    if not sqlite:
        options.update(pool_size=5, max_overflow=5, pool_timeout=5, pool_recycle=300)
        if url.drivername == "postgresql+psycopg":
            options["connect_args"]["prepare_threshold"] = None
    return url, sqlite, options


def set_transaction_timeouts(connection):
    # Transaction-local settings also work with transaction-mode poolers.
    connection.exec_driver_sql(
        "SELECT set_config('statement_timeout', '10s', true), "
        "set_config('lock_timeout', '5s', true), "
        "set_config('idle_in_transaction_session_timeout', '15s', true)"
    )
