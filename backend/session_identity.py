from sqlalchemy import and_, func, or_
import models


def is_active_session(row):
    # Reservation-only legacy rows have neither a name nor a started session key.
    return bool(row and ((row.customer_name or "").strip() or (row.session_key and row.started_at is not None)))


def active_session_filter():
    return or_(
        func.length(func.trim(func.coalesce(models.ActiveSession.customer_name, ""))) > 0,
        and_(models.ActiveSession.session_key != "", models.ActiveSession.started_at.is_not(None)),
    )
