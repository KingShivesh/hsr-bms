from sqlalchemy import Column, Integer, String, Boolean, Float, Text
from database import Base

class Settings(Base): #This tells SQLAlchemy This class should become a database table.
    __tablename__ = "settings"
    id           = Column(Integer, primary_key=True, index=True)
    username     = Column(String,  default="admin")
    password     = Column(String,  default="admin123")
    wr           = Column(Integer, default=320)
    pr           = Column(Integer, default=170)
    sr           = Column(Integer, default=270)
    min_session  = Column(Integer, default=0)
    gst_percent  = Column(Float,   default=0)
    booking_grace_minutes = Column(Integer, default=10)

class Member(Base):
    __tablename__ = "members"
    id          = Column(Integer, primary_key=True, index=True)
    customer_id = Column(String,  unique=True, index=True)
    name        = Column(String,  index=True)
    visits      = Column(Integer, default=0)
    spent       = Column(Integer, default=0)
    member_type = Column(String,  default="Regular")
    last_visit  = Column(String,  default="-")

class Transaction(Base):
    __tablename__ = "transactions"
    id             = Column(Integer, primary_key=True, index=True)
    date           = Column(String)
    ts             = Column(Float)
    table_id       = Column(String)
    customer_name  = Column(String)
    duration       = Column(Integer)
    play_charge    = Column(Integer)
    food_charge    = Column(Integer)
    food_items     = Column(Text,    default="None")
    food_json      = Column(Text,    default="[]")
    total          = Column(Integer)
    notes          = Column(Text,    default="")
    split          = Column(Boolean, default=False)
    split_names    = Column(Text,    default="")
    billing_mode   = Column(String,  default="single")  # single / sharing / lp
    players_json   = Column(Text,    default="[]")
    payer_name     = Column(String,  default="")
    gst_amt        = Column(Integer, default=0)
    peak_surcharge = Column(Integer, default=0)
    payment_method = Column(String,  default="Cash")   # Cash / UPI

class ActiveSession(Base):
    __tablename__ = "active_sessions"
    table_id      = Column(String,  primary_key=True, index=True)
    start_time    = Column(Float)
    customer_name = Column(String)
    rate          = Column(Integer)
    food_total    = Column(Integer, default=0)
    food_items    = Column(Text,    default="[]")
    paused        = Column(Boolean, default=False)
    elapsed_ms    = Column(Float,   default=0)
    reservation   = Column(Text,    default=None)
    notes         = Column(Text,    default="")
    split         = Column(Boolean, default=False)
    split_name    = Column(Text,    default="")
    billing_mode  = Column(String,  default="single")  # single / sharing / lp
    players_json  = Column(Text,    default="[]")
    session_key   = Column(String,  default="")

class SessionFrame(Base):
    __tablename__ = "session_frames"
    id                 = Column(Integer, primary_key=True, index=True)
    table_id           = Column(String, index=True)
    session_key        = Column(String, default="", index=True)
    session_started_at = Column(Float, index=True)
    frame_no           = Column(Integer, default=1)
    started_at         = Column(Float)
    ended_at           = Column(Float, default=0)
    loser_name         = Column(String, default="")
    status             = Column(String, default="open")  # open / closed

class MenuItem(Base):
    __tablename__ = "menu_items"
    id        = Column(Integer, primary_key=True, index=True)
    name      = Column(String,  unique=True, index=True)
    price     = Column(Integer)
    category  = Column(String,  default="Snacks")
    available = Column(Boolean, default=True)

class FoodOnlyOrder(Base):
    __tablename__ = "food_only_orders"
    id            = Column(Integer, primary_key=True, index=True)
    date          = Column(String)
    ts            = Column(Float)
    customer_name = Column(String)
    items         = Column(Text)
    total         = Column(Integer)
    payment_method = Column(String, default="Cash")

class TableMaintenance(Base):
    __tablename__ = "table_maintenance"
    table_id = Column(String,  primary_key=True, index=True)
    reason   = Column(String,  default="Under maintenance")
    since    = Column(String)

class WaitlistEntry(Base):
    __tablename__ = "waitlist_entries"
    id             = Column(Integer, primary_key=True, index=True)
    customer_name  = Column(String, index=True)
    phone          = Column(String, default="")
    party_size     = Column(Integer, default=1)
    preferred_type = Column(String, default="ANY")  # ANY / POOL / SNOOKER
    notes          = Column(Text, default="")
    status         = Column(String, default="waiting")  # waiting / seated / cancelled
    created_at     = Column(String)
    ts             = Column(Float)
    seated_table   = Column(String, default="")

class Booking(Base):
    __tablename__ = "bookings"
    id             = Column(Integer, primary_key=True, index=True)
    customer_name  = Column(String, index=True)
    phone          = Column(String, default="")
    table_id       = Column(String, default="ANY")
    table_type     = Column(String, default="ANY")
    booking_time   = Column(String, index=True)
    duration_mins  = Column(Integer, default=60)
    notes          = Column(Text, default="")
    status         = Column(String, default="booked")  # booked / missed / cancelled / completed
    created_at     = Column(String)
    ts             = Column(Float)
    released_at    = Column(String, default="")

class StaffRoleSetting(Base):
    __tablename__ = "staff_role_settings"
    id              = Column(Integer, primary_key=True, index=True)
    role            = Column(String, unique=True, index=True)
    can_reset       = Column(Boolean, default=False)
    can_settings    = Column(Boolean, default=False)
    can_reports     = Column(Boolean, default=False)

class Challenge(Base):
    __tablename__ = "challenges"
    id             = Column(Integer, primary_key=True, index=True)
    player_name    = Column(String, index=True)
    game_type      = Column(String, default="8 Ball")
    preferred_time = Column(String, default="")
    note           = Column(Text, default="")
    status         = Column(String, default="open")  # open / matched / closed
    opponent_name  = Column(String, default="")
    created_at     = Column(String)
    ts             = Column(Float)

class PeakHourRate(Base):
    __tablename__ = "peak_hour_rates"
    id         = Column(Integer, primary_key=True, index=True)
    start_hour = Column(Integer)
    end_hour   = Column(Integer)
    multiplier = Column(Float,   default=1.5)
    label      = Column(String,  default="Peak Hours")

class SecurityControl(Base):
    __tablename__ = "security_controls"
    id                          = Column(Integer, primary_key=True, index=True)
    manager_pin_hash            = Column(String,  default="")
    require_pin_for_resets      = Column(Boolean, default=False)
    alert_unbilled_minutes      = Column(Integer, default=10)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id       = Column(Integer, primary_key=True, index=True)
    date     = Column(String)
    ts       = Column(Float)
    action   = Column(String, index=True)
    severity = Column(String, default="info")
    staff    = Column(String, default="admin")
    detail   = Column(Text, default="")
    amount   = Column(Integer, default=0)

class Tournament(Base):
    __tablename__ = "tournaments"
    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String, index=True)
    game_type   = Column(String, default="8 Ball")
    entry_fee   = Column(Integer, default=0)
    status      = Column(String, default="active")
    winner_name = Column(String, default="")
    created_at  = Column(String)
    ts          = Column(Float)

class TournamentPlayer(Base):
    __tablename__ = "tournament_players"
    id            = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, index=True)
    name          = Column(String, index=True)
    seed          = Column(Integer, default=0)
    eliminated    = Column(Boolean, default=False)

class TournamentMatch(Base):
    __tablename__ = "tournament_matches"
    id            = Column(Integer, primary_key=True, index=True)
    tournament_id = Column(Integer, index=True)
    round_no      = Column(Integer, default=1)
    match_no      = Column(Integer, default=1)
    player1       = Column(String, default="")
    player2       = Column(String, default="")
    winner        = Column(String, default="")
    status        = Column(String, default="scheduled")
    completed_at  = Column(String, default="")

'''
"models.py defines the database schema using SQLAlchemy's ORM. Each Python class represents a database table, and each Column defines a field in that table. Relationships between tables are established using foreign keys, allowing the application to connect members, sessions, food orders, and transactions without duplicating data. SQLAlchemy automatically translates these Python objects into SQL queries, making the code cleaner, safer, and easier to maintain."
'''
