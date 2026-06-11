# Supabase Migration SaaS

This is the isolated SaaS version of the existing migration wizard. It lives next to the legacy `webapp` folder and does not modify it.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, use the demo login, and create a job from the dashboard.

## Security Model

- Root SSH passwords, database URLs, service-role keys, JWT secrets, and tokens are accepted only in the job request.
- Secrets are not persisted in job records, summaries, job logs, or the Supabase schema.
- Logs pass through a masking layer before they are stored or streamed.
- Retry jobs require credentials to be re-entered unless a future agent/KMS model is added.

## Runner Modes

- `SAAS_RUNNER_MODE=dry-run`: default safe mode. It validates the SaaS flow, logs, status changes, and secret masking without touching customer servers.
- `SAAS_RUNNER_MODE=legacy`: bridges job requests to the existing legacy `webapp` API via `LEGACY_WEBAPP_URL`. Keep the old server running separately with `npm start` inside `webapp`.

## Supabase DB

Use `supabase/schema.sql` for the first database migration. The schema intentionally has no credential storage columns.

## Production Deploy (Portainer + GHCR)

The repo is a self-contained stack: `web` (Next.js UI + BullMQ worker), `legacy` (migration API in `legacy/`, internal-only) and `redis`. Images are **pre-built on GitHub Actions** and pushed to GHCR, so the server never needs npm access — Portainer only pulls images.

### One-time setup

1. **Supabase project**: run `supabase/schema.sql` in the SQL Editor. In Authentication → URL Configuration set the Site URL and add `https://<your-domain>/auth/callback` as a redirect URL. Configure a custom SMTP (magic-link login).
2. **GitHub repo Variables** (Settings → Secrets and variables → Actions → **Variables** tab) — baked into the client bundle at image build time:

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `NEXT_PUBLIC_SITE_URL` | ✅ | `https://<your-domain>` |
| `NEXT_PUBLIC_FROM_EMAIL` | ✉️ | e.g. `BaseUp <noreply@your-domain>` |

3. **Build the images**: Actions → "Build & push images" → **Run workflow** (also runs automatically on every push to `main`). Re-run it whenever a `NEXT_PUBLIC_*` variable changes.
4. **Make the packages public** (once, after the first successful run): on the repo main page open each package (`baseup-web`, `baseup-legacy`) → Package settings → Change visibility → **Public**. Otherwise Portainer needs GHCR credentials to pull.

### Deploy

**Portainer** → Stacks → Add stack → **Repository**:
- Repository URL: `https://github.com/mazisel/baseup.git`
- Compose path: `docker-compose.yml`

Environment variables (runtime):

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Worker writes job status/logs with it |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SITE_URL` | ✅ | Same values as the GitHub Variables (used by server-side code) |
| `ADMIN_EMAILS` | ✅ | Comma-separated admin e-mails |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `NEXT_PUBLIC_FROM_EMAIL` | ✉️ | Job completion / uptime e-mails. `RESEND_FROM_EMAIL` must use a verified Resend domain, e.g. `BaseUp <noreply@your-domain>` |
| `PAYTR_MERCHANT_ID` / `PAYTR_MERCHANT_KEY` / `PAYTR_MERCHANT_SALT` | 💳 | Billing; set the PayTR callback to `https://<your-domain>/api/billing/paytr/callback` |
| `SAAS_RUNNER_MODE` | — | Defaults to `legacy` in compose (real runs) |
| `LEGACY_WEBAPP_URL` | — | Defaults to `http://legacy:4567` (internal service) |
| `WEB_PORT` | — | Host port for the UI, defaults to `3000` (set e.g. `3001` if 3000 is taken by Supabase Studio) |

To ship an update: push to `main` (or re-run the workflow), then **Pull and redeploy** in Portainer. Put a reverse proxy with TLS in front of the web port.

> **Security**: the `legacy` and `redis` services intentionally publish no ports. The legacy API is unauthenticated and executes root SSH commands on customer servers — never expose it publicly.
