# Watchora — Operations Runbook

Everything needed to run the live deployment. Written 2026-09-02 after the
hardening + growth tranches; the deploy pipeline has since been verified
green end-to-end.

## Production topology

- **App**: `Orazen/watchoraa` branch `main` → GitHub Actions → Docker image
  built on the VPS → Swarm service `mjna70kuhhz7`
  (`orazen-watchora-c1gnyj`) → Traefik → https://watchora.ramagiritharun.in
- **VPS**: `bookoraa-vps` (173.249.38.101, user `tarun`, `ssh bookoraa-vps`)
- **Database**: `dokploy-postgres` container, database `watchora`, dedicated
  role `watchora_app`. Migrations run automatically on container boot
  (`prisma migrate deploy` in the image CMD).
- **Dokploy app id**: `WsG_EVjgSbMh4bE6zbezD` (panel of record for env,
  domains, logs). Dokploy's GitHub webhook is NOT relied on for deploys.

## Deploy pipeline (deterministic, verified)

Every push to `main`:

1. **CI** — frontend build + vitest (114), server prisma validate + build +
   vitest (84). Both must pass.
2. **deploy** — rsync source to `~/watchora-build/` on the VPS → detached
   `docker build` with marker-file completion (`__BUILD_OK__` /
   `__BUILD_FAIL__` in `/tmp/watchora-build.log`) → `docker service update
   --force` → poll `https://watchora.ramagiritharun.in/api/healthz` for 200
   with retries. Red X on any step = deploy did not happen.

Manual equivalents (also the fallback if Actions is down):

```bash
rsync -a --exclude node_modules --exclude .git --exclude dist \
  /path/to/watchoraa/ bookoraa-vps:~/watchora-build/
ssh bookoraa-vps 'cd ~/watchora-build && docker build -t orazen-watchora-c1gnyj:latest . | tail -2'
ssh bookoraa-vps 'docker service update --force --detach mjna70kuhhz7'
```

## Environment variables (Dokploy → Environment tab)

Persisted in Dokploy's application record AND the swarm service. Reference
copy of the values: `~/watchora.env` on the VPS (chmod 600).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres via `dokploy-postgres:5432/watchora` |
| `JWT_SECRET` | yes | Token signing (32-byte hex) |
| `CORS_ORIGIN` | yes | `https://watchora.ramagiritharun.in` |
| `PORT` | yes (3000) | Domain maps container port 3000 |
| `GEMINI_API_KEY` | optional | Live AI descriptions; without it AI runs honestly labeled demo mode |
| `SMTP_HOST/PORT/USER/PASS/FROM` | optional | Password-reset + SOS email delivery |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER` | optional | SOS SMS delivery |
| `PUBLIC_APP_URL` | recommended | Base URL inside reset/SOS emails |
| `EXPOSE_DEV_RESET_TOKEN` | **never in prod** | Returns raw reset tokens (dev convenience) |

Alert degradation without keys is intentional: no SMTP → email alerts log
server-side and audit `delivered: 0`; no Twilio → SMS skipped. The user
never sees a false "contact notified".

## Routine operations

- **Check health**: `curl https://watchora.ramagiritharun.in/api/healthz` →
  `{"ok":true}`
- **Logs**: `ssh bookoraa-vps 'docker logs $(docker ps -q --filter
  name=orazen-watchora) --tail 100'` (pino JSON; 5xx entries have full
  stack traces server-side, clients only get generic messages)
- **Container crash-loop**: almost always a boot failure — check
  `docker logs` of an exited container. Historically: missing env (fix:
  Dokploy env tab), DB permission (fix: role ownership).
- **New migration**: add to `server/prisma/migrations/`; the container
  applies it on next boot automatically.

## First-run & admin

- The very first signup on an empty user table becomes ADMIN (advisory-lock
  protected). Production already has its admin.
- Admin capabilities: user deactivate/activate (`PATCH /api/admin/users/:id/
  active`), incident moderation, AI usage stats, prompt versions, audit log.
- Test account (kept for demos): `e2e.1788375691655@watchora-test.dev`,
  password in the session notes. Deactivate or delete before real launch.

## Known limitations (deliberate)

- Dokploy panel "Deploy" button may overwrite service-level env with its own
  record — env is persisted in both places, so this is safe, but check the
  Environment tab if a container ever boots with `PORT` only.
- Webhook-based autodeploy (Dokploy GitHub App) is unreliable on this VPS —
  the Actions pipeline is the source of truth for deploys.
- ML assets (~60 MB) warm in the service worker after first activation;
  first-visit users need one online session for full offline capability.
