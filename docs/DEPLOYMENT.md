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
```

Railway provides `PORT` for the public Next.js server. Do not set `NEXT_PUBLIC_API_URL` in production; an unset value makes the browser use same-origin `/api` requests. Set `WEB_ORIGIN` to the final `https://` public domain after Railway generates it.

Generate `SESSION_SECRET` locally with a password manager or a cryptographically secure random generator. Never commit it to Git.

## Persistence and Backups

Only files below `/data` survive redeploys. The configured database path is `/data/triggerlane`. Confirm the volume is mounted before inviting users, then enable Railway volume backups appropriate to the deployment tier.

Keep the service at one replica while it uses PGlite. Moving to multiple replicas requires migrating persistence to a managed PostgreSQL database and separating the worker lifecycle.

## First Deployment Check

1. Open `/health/ready` and confirm the database reports `ready`.
2. Open the landing page and start an anonymous Sandbox session.
3. Create and start a one-condition trigger.
4. Advance Demo Feed until it fills and inspect its receipt.
5. Run Replay and open Portfolio and History.
6. Refresh the browser and confirm the same session data remains.
7. Redeploy the same commit and confirm the data still remains after restart.
8. Switch to Live Data and confirm execution remains disabled.

## Rollback Rule

Do not promote a release if `/health/ready` fails, session data disappears after restart, the worker lease is inactive, or Live Data can execute. Roll back to the last healthy image and preserve the `/data` volume for diagnosis.
