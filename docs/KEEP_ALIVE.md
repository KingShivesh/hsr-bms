# Render Free-Tier Keep-Alive

HSR uses `.github/workflows/keep-alive.yml` to request the backend health
endpoint every 10 minutes. Render documents that Free web services spin down
after 15 minutes without inbound traffic, and that incoming HTTP requests keep
the service active or wake it after a spin-down. The workflow is therefore a
best-effort way to reduce cold starts, not an availability guarantee.

## Known limitations

- GitHub Actions schedules can be delayed during high load, and queued jobs can
  occasionally be dropped. A cold start can still occur when the interval
  between successful requests exceeds 15 minutes.
- GitHub automatically disables scheduled workflows in public repositories
  after 60 days without repository activity. Resume or edit the schedule if
  this repository becomes inactive for that long.
- Render grants 750 Free instance hours per workspace each calendar month. One
  continuously active service consumes about 720 hours in a 30-day month and
  744 hours in a 31-day month, leaving very little margin. Any other Free web
  service in the same Render workspace shares the same pool and can cause all
  Free services to be suspended after the allowance is exhausted.
- This repository declares one Free Render service, `hsr-bms-backend`. The
  account-wide service inventory is not stored in the repository and must be
  checked in the Render Dashboard before relying on the 750-hour estimate.
- Render can restart a Free service at any time. A paid always-on instance is
  the reliable option for production availability.

## Verification

The workflow supports `workflow_dispatch` so it can be run immediately after a
deployment. A successful run confirms that GitHub reached `/health` and
received a 2xx response; it does not guarantee future scheduled runs.

References:

- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://render.com/docs/free
