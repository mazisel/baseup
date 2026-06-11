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
