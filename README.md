# HSR Snooker Club BMS

A local billiards hall management system customized for HSR Snooker Club.
It tracks table sessions, members, cafeteria orders, reports, and operations
settings.

## Stack

- **Backend:** FastAPI + SQLAlchemy + SQLite
- **Frontend:** React + Vite

## Quick start

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python seed.py
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

**Default login:** `admin` / `admin123`

Change credentials under **Settings → General → Change Credentials**.

## HSR setup

This copy is preconfigured for the HSR table layout:

| Table | Type | Rate |
|-------|------|------|
| `T1` | Wiraka | `₹320/hour` default |
| `T2` | Wiraka | `₹320/hour` default |
| `T3` | English | `₹270/hour` |
| `T4` | English | `₹270/hour` |
| `T5` | Pool | `₹170/hour` |

These rates are editable in **Settings → General**. The backend enforces the
saved rate by table ID, so billing uses the correct rate even if the frontend
sends a stale value.

The cafeteria menu from the customer photo is loaded by `python seed.py`.
Cigarettes are handled as a special item: staff enter MRP, and the system bills
`MRP + ₹3` per quantity.

## Features

| Module | Description |
|--------|-------------|
| **Dashboard** | Today's sales, customers, active tables |
| **Tables** | Start/pause/stop sessions, food orders, reservations, checkout |
| **Members** | Customer registry with visit/spend tracking |
| **Food Orders** | Standalone food orders (no table session) |
| **Reports** | History, analytics, CSV export, closing report |
| **Settings → General** | Rates, menu, min session time, credentials |
| **Settings → Operations** | Peak-hour pricing, GST |

## Checkout pricing

At checkout, the bill is calculated as:

1. **Play charge** — hourly rate × duration, with peak-hour multiplier if applicable
2. **Food charge** — items added during the session
3. **GST** — applied to the subtotal

## Security

- JWT authentication on all API routes except `/auth/login`
- Passwords stored as bcrypt hashes (plain-text passwords are auto-migrated on login)
- Set a production secret: `export SECRET_KEY="your-random-secret"`

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `sqlite:///./hsr_billiards.db` | SQLAlchemy database URL. Use a Supabase/Postgres connection string in production. |
| `SECRET_KEY` | dev default | JWT signing key |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated frontend URLs allowed by CORS |
| `VITE_API_URL` | `http://localhost:8000` | Frontend build-time API URL |

For local development, copy `backend/.env.example` to `backend/.env` and
`frontend/.env.example` to `frontend/.env` if you need to override defaults.

## Deployment notes

Supabase is a good fit for the database, but it does not host this FastAPI
backend. Use Supabase for Postgres, then deploy:

1. **Backend** to a Python web host such as Render, Railway, Fly.io, or a VPS.
   - Build/install: `pip install -r requirements.txt`
   - Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Set `DATABASE_URL`, `SECRET_KEY`, and `ALLOWED_ORIGINS`.
2. **Frontend** to Vercel, Netlify, Cloudflare Pages, or the same host as a
   static site.
   - Build command: `npm run build`
   - Output directory: `dist`
   - Set `VITE_API_URL` to the deployed backend URL.
3. **Supabase** project:
   - Create a project and copy the pooled Postgres connection string.
   - Use it as `DATABASE_URL`.
   - Run `python seed.py` once against production to create the default admin
     and menu items, then immediately change the credentials in Settings.

## Project structure

```
billiards-bms/
├── backend/
│   ├── main.py          # App entry + router registration
│   ├── deps.py          # Auth helpers (JWT, bcrypt)
│   ├── pricing.py       # Checkout pricing logic
│   ├── models.py        # Database schema
│   ├── seed.py          # Initial data
│   └── routers/         # API route modules
└── frontend/
    └── src/
        ├── App.jsx
        ├── api/index.js
        └── components/
```

## Development

```bash
# Backend API docs
open http://localhost:8000/docs

# Frontend lint
cd frontend && npm run lint
```
