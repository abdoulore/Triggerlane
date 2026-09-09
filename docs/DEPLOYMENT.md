# Deploy Triggerlane to Railway

Triggerlane deploys as one Docker service. The container runs the Next.js interface, Fastify API, background worker, and PGlite database process together. Only the Next.js port is public; API and event-stream requests are proxied internally so browser sessions remain first-party.

## Required Railway Resources

- One Railway service connected to the GitHub repository.
- One persistent volume mounted at `/data`.
- One generated Railway domain or custom domain.
- One production session secret.

Do not create separate web and API services for this MVP. PGlite and the worker are intentionally single-instance, and splitting the services would add cross-origin session behavior without improving reliability.

## Service Setup

1. Create a Railway project and add the Triggerlane GitHub repository as a service.
2. Keep the repository root as the service root. Railway automatically detects the root `Dockerfile`.
3. Add a volume to the service and mount it at `/data`.
4. Generate a public Railway domain under **Networking**.
5. Set the health-check path to `/health/ready` with a 300-second timeout.
6. Keep the service at one replica. A PGlite volume must not be shared by multiple application replicas.
7. Enable automatic deploys from the protected production branch only after the first smoke test passes.

## Environment Variables

Set these in Railway:

```text
NODE_ENV=production
SESSION_SECRET=<a cryptographically random value of at least 32 characters>
PGLITE_DATA_DIR=/data/triggerlane
API_HOST=127.0.0.1
API_PORT=8787
API_INTERNAL_URL=http://127.0.0.1:8787
TRUST_PROXY_HOPS=1
OPERATIONS_TOKEN=<a separate cryptographically random value of at least 32 characters>
```

Railway provides `PORT` for the public Next.js server. Do not set `NEXT_PUBLIC_API_URL` in production; an unset value makes the browser use same-origin `/api` requests. Set `WEB_ORIGIN` to the final `https://` public domain after Railway generates it.

Generate `SESSION_SECRET` locally with a password manager or a cryptographically secure random generator. Never commit it to Git.

## Persistence and Backups

Only files below `/data` survive redeploys. The configured database path is `/data/triggerlane`. Confirm the volume is mounted before inviting users, then enable Railway volume backups appropriate to the deployment tier.

Keep the service at one replica while it uses PGlite. Moving to multiple replicas requires migrating persistence to a managed PostgreSQL database and separating the worker lifecycle.

Detailed diagnostics, integrity checks, and the retention report require `Authorization: Bearer <OPERATIONS_TOKEN>` in production. `/health` and `/health/ready` remain public and contain no account data.

For an offline filesystem backup, stop the service so PGlite has no writer, then run `npm run data:backup -- /data/triggerlane /backup/triggerlane-YYYYMMDD`. Restore only into a new empty path with `npm run data:restore -- /backup/triggerlane-YYYYMMDD /data/triggerlane-restored`; point a separate verification instance at that restored path before any replacement. Both commands refuse to overwrite an existing destination and write a SHA-256 manifest. Railway volume snapshots remain the preferred hosted backup mechanism.

`GET /health/retention` is report-only. It identifies anonymous accounts beyond the configured retention window but cannot delete them. Enabling deletion requires a separately reviewed policy and explicit approval.

## Starting Resource Limits

The committed defaults are 300 API requests per IP per minute, 90 mutations per session per minute, 60 new anonymous accounts per IP per hour, four live-event streams per session, 100 streams process-wide, and 100 stored triggers per account. These are protective solo-demo ceilings, not capacity claims. `npm run test:load` verifies controlled `429` behavior under 340 concurrent in-process requests and a mutation burst. Re-run and tune against production telemetry before materially increasing traffic or replicas.

Paginated collection APIs are available at `/api/ghost-pages`, `/api/history-pages`, `/api/ledger-pages`, and `/api/ghosts/:id/activity`. They accept bounded `limit` and opaque `cursor` values and return independent totals; the legacy workspace response is capped at 100 records per major collection for current UI compatibility.

## First Deployment Check

Before deployment, run `npm run test:container` on a Docker-capable machine. It builds the root image, starts the production topology through port 3000, verifies readiness and production cookie attributes, creates and reserves a trigger, restarts against the same volume, settles it, restarts again, and confirms the session, trigger, reservation, receipt, and balances remain available. The harness removes its disposable container, image, and volume after the run.

1. Open `/health/ready` and confirm the database reports `ready`.
2. Open the landing page and start an anonymous paper-trading session.
3. Create and start a one-condition trigger.
4. In Guided Scenario, advance the stored steps until the trigger fills and inspect its receipt.
5. Run Replay and open Portfolio and History.
6. Refresh the browser and confirm the same session data remains.
7. Redeploy the same commit and confirm the data still remains after restart.
8. Switch to Live Data and confirm a fresh provider frame remains eligible for virtual execution.

## Rollback Rule

Do not promote a release if `/health/ready` fails, session data disappears after restart, the worker lease is inactive, or Live Data can execute. Roll back to the last healthy image and preserve the `/data` volume for diagnosis.
