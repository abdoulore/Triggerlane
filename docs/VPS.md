# Deploy Triggerlane to a single VPS

Triggerlane is deliberately one process with one file-backed database, so a
single host suits it better than a platform that expects to scale replicas.
Caddy terminates TLS in front; the app is never published directly.

## Prerequisites

- A host with Docker and the Compose plugin.
- A domain with an `A` record pointing at the host, and ports 80 and 443 open.
  TLS is not optional: the session cookie is set `secure`, so over plain HTTP
  the browser discards it and every screen fails to load an account.
- 2 GB of RAM is comfortable. PGlite is PostgreSQL compiled to WebAssembly and
  runs in-process beside Next.

## Setup

```bash
git clone https://github.com/abdoulore/Triggerlane.git
cd Triggerlane

cat > .env <<EOF
DOMAIN=triggerlane.example.com
WEB_ORIGIN=https://triggerlane.example.com
SESSION_SECRET=$(openssl rand -hex 32)
OPERATIONS_TOKEN=$(openssl rand -hex 32)
RATE_LIMIT_ANONYMOUS_SESSIONS_PER_HOUR=600
EOF

docker compose up -d --build
```

The first build takes a few minutes. Watch it come up with
`docker compose logs -f app`, then open `https://<domain>/health/ready`, which
should report the database as ready.

## Confirm it survived a restart

Data loss on redeploy is the failure worth catching before anyone else sees
the site, because it is silent until someone returns to a missing account.

1. Open the site, let it start a paper account, and place a one-condition
   trigger.
2. `docker compose restart app`.
3. Reload. The same trigger, balances and ledger must still be there.

If they are gone, the volume is not mounted. Fix that before continuing.

## Updating

```bash
git pull
docker compose up -d --build
```

The schema block runs on boot and adds anything missing, so an older database
migrates in place rather than needing a separate migration step.

## Backups

`triggerlane-data` holds every paper account, trigger, receipt and ledger
entry. Nothing else in the container is durable.

```bash
docker compose stop app          # PGlite must have no writer
docker run --rm -v triggerlane_triggerlane-data:/data -v "$PWD:/backup" \
  alpine tar czf /backup/triggerlane-$(date +%F).tar.gz -C /data .
docker compose start app
```

## Settings that matter

| Variable | Why |
|---|---|
| `TRUST_PROXY_HOPS=1` | Exactly one proxy sits in front. At `0` the API reads Caddy's address as the client, so every visitor shares one rate-limit bucket and they exhaust it between them. |
| `API_INTERNAL_URL` | Stays on loopback. Next rewrites `/api` and `/health` to it, which is what keeps the session cookie first-party. |
| `NEXT_PUBLIC_API_URL` | Leave unset. Setting it makes the browser call the API cross-origin, and a `sameSite=lax` cookie will not follow. |
| `RATE_LIMIT_ANONYMOUS_SESSIONS_PER_HOUR` | The committed default of 60 is a solo-demo ceiling. Visitors behind one office or conference network share an address and lock each other out. |

`flush_interval -1` in the Caddyfile is load-bearing. Triggerlane streams live
trigger updates over server-sent events, and a proxy that buffers that stream
leaves the interface looking frozen until someone refreshes.

## Operating notes

- Keep one replica. PGlite takes a single writer, and two containers pointed at
  one volume will corrupt it.
- `/health` and `/health/ready` are public and carry no account data. The
  detailed diagnostics need `Authorization: Bearer $OPERATIONS_TOKEN`.
- This is paper trading against live market data. No real assets move, and the
  Rialo execution target is not configured.
