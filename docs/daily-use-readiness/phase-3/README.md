# Phase 3: Security and Access Review

Status: initial read-only review, **not a completed security-hardening release**.
Branch `codex/security-access-review` is based on approved Phase 2 `2307dac`.
There are no application, schema, palette, font, credential or permission changes
in this checkpoint. Production financial records were not read or changed.

The owner approved Phase 2 merge/deployment on 21 November 2026. The deployment
preflight occurred at about 10:47 PM IST, during the 11 AM-2 AM business shift.
The approved rollout plan calls for a quiet 3-11 AM window, no open tables and a
backup. The owner subsequently confirmed the club is idle, a backup is ready,
and explicitly approved deploying now. At this review checkpoint main is still
`6471be2`; the staged Phase 2 cutover is next. No scheduled deployment was created.

Production `/health` and `/ready` initially exceeded 15-second requests. A later
read-only check using the documented longer wake budget returned 200 for both,
database OK, revision `5f23897`. The cold-start limitation still applies; a short
timeout alone is not evidence of a permanent outage.

## Confirmed Findings

| Severity | Finding | Evidence | Next Action |
| --- | --- | --- | --- |
| High | Staff receives full business summary, including revenue, averages and yesterday/trends. | `access-before.json`: Staff `/reports/summary` returns 200; Owner policy probe expects 403. | Preserve the Staff shell's operational table count through a narrow schema/endpoint; keep business totals Owner-only. Do not simply break the Staff header's existing summary request. |
| High | Staff can retrieve detailed closing report and closing insights. | Staff `/reports/closing-report` and `/reports/closing-insights` return 200. Response fields include tender totals, receipts and reconciliation. | Enforce Owner checks on the backend and align the Staff navigation/route guard. Per-table checkout and trusted Staff time editing must remain available. |
| Medium | Production CORS accepts an unrelated Vercel origin with credentials allowed. | `public-surface.json`: preflight 200, matching unrelated origin echoed, credentials true. | Restrict to explicitly approved production/local origins; define how preview origins are approved. This is not an unauthenticated bypass of bearer-token checks. |
| Medium | Frontend login response lacks CSP, frame restriction, nosniff and Referrer-Policy headers. | `public-surface.json`; HSTS is present. Backend has separate security headers. | Add tested frontend headers and a staged CSP without breaking existing fonts/assets. |
| High advisory ratings; exploitability not established | Current npm audit flags `follow-redirects`, `vite` and `zod`. | `npm-audit.json`, 3 High packages, 0 Critical. | Review current upstream fixes, update in an isolated install, rebuild and regress. Several listed paths are Node/development tooling, not demonstrated browser-production exploits. Do not equate package counts with three successful attacks. |
| Low / log hygiene | Six JWT strings are present in historical QA logs. | Gitleaks 8.30.1 scanned 372 commits reachable from 51 valid local ref tips. All six tokens are expired. Four signatures match known QA keys; two occur in test request logs with checkout-only claims. No token values are stored in this report. | Redact future test diagnostics and current log copies; retain narrow, reviewed historical fingerprints rather than blanket ignoring logs. No live production key leak or need for key rotation is established by these findings alone. |

## Verification

`access-before.json` records 84 local HTTP comparisons: 81 pass, 3 fail. The three
failures above are deliberately retained as **baseline failures**, not a green
security gate. Anonymous requests to all 28 probed protected endpoints return 401.
The audit uses disposable SQLite fixtures and removes all fixture rows afterward.
Only response shapes/field names and HTTP statuses are retained, not receipt or
member values. GET `/staff/roles` can seed its configuration even though it is a
GET; this happened only in the disposable fixture, not production.

Anonymous access, Owner/Staff separation, financial reports, member financial
listing, account/setup, audit/security controls, and essential floor/menu/booking
lookup routes are included. This is not yet an exhaustive mutation permission or
cross-session revocation test. Existing auth regression coverage is retained but
has not been represented as a fresh complete Phase 3 pass.

Run the baseline locally (nonzero exit currently expected):

```sh
cd backend
python audit_access_boundaries.py --output ../docs/daily-use-readiness/phase-3/access-before.json
```

The fixture refuses non-loopback PostgreSQL URLs; with no test URL it creates a
disposable SQLite database. Never aim a destructive fixture at production.

Secret scanning uses the official Gitleaks 8.30.1 release, verified against the
published SHA-256 checksum before execution. Only location metadata is retained.
Malformed existing Git refs were skipped by Git enumeration and left untouched.
Unreachable/reflog-only objects and remote refs not present locally were not
scanned. A secret scan is not proof that credentials were never exposed elsewhere.

```sh
cd frontend
GITLEAKS_PATH=/path/to/verified/gitleaks node scripts/scan-secrets-history.mjs
```

## Access and Environment Gaps

- The application currently authenticates only `admin` (Owner) and `staff`.
  Manager/Cashier/Waiter rows in the roles-settings screen do not create actual
  authenticated identities or enforce those roles. Do not claim otherwise or
  silently invent a new employee/tenant model.
- JWT lifetime remains 24 hours, with no silent refresh. Credential-version and
  per-token revocation checks exist; streams recheck authority. Long-lived counter
  tablets still face a fresh login when a token expires. This remains a separate
  design decision, not permission to silently lengthen tokens.
- Login limits are account-wide but in-process. Restart/multiple-worker behavior,
  unknown-username spraying, and limits on other sensitive writes need explicit
  tests before calling Phase 3 complete. The single-worker deployment assumption
  must not be treated as persistent/distributed rate limiting.
- Supabase RLS, exposed schemas, grants, Data API settings and actual database-role
  privileges have **not** been inspected. The available local backend `.env` uses
  SQLite and contains no Supabase connection URL. No secret values were printed.
  Owner-assisted dashboard/catalog access is required for production verification.
- Source uses server-side SQLAlchemy/Postgres, not a Supabase browser client.
  [Supabase's guidance](https://supabase.com/docs/guides/api/securing-your-api)
  recommends disabling the Data API when unused, or enforcing explicit exposure,
  grants and RLS. No production setting was changed. RLS alone cannot protect data
  from a privileged role with BYPASSRLS; see [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Current production secret strength, rotation history, pooler TLS enforcement,
  all sensitive input paths, Python dependency advisories and frontend security
  regression tests remain unverified in this checkpoint. The earlier audit's
  residual Python advisory notes are not a current clean scan.

## Next Checkpoint

Confirm the safe Phase 2 deployment window/backup, then merge and verify the real
runtime revision, readiness version 2, bundle hashes and commit ancestry. After
that, implement and test the Phase 3 findings in small reviewed changes. Do not
merge this partial review branch as though the security work were complete.
No SSE expansion, production account creation, key rotation, history rewrite,
RLS change or backup operation has been performed.
