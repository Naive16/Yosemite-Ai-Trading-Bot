> Current backend: Supabase Auth and Data API. Follow [the current release runbook](cloudflare-deployment.md); legacy Neon/custom-session references below describe historical operations only and must not be used for this release. Trading and broker connections remain disabled.

# Yosemite AI Operations Runbook

Milestone 13 operations are fail-closed and read-only. No runbook step enables trading, submits an order, or retries an unknown broker outcome.

## Deployment and configuration

1. Validate `APP_ENV`, `APP_ORIGIN`, `DATABASE_URL`, authentication secrets, and `TRUSTED_PROXY_MODE` in the deployment secret store.
2. Keep `TRADING_MODE=disabled`, `LIVE_TRADING_ENABLED=false`, and `MT5_EXECUTION_ENABLED=false`.
3. Run `npm run verify` before deployment. Apply migrations with the direct, non-pooled `DATABASE_URL_UNPOOLED` only after backup/restore procedures and approval.
4. Inspect the authenticated operations view after startup. A missing database, stale worker, unavailable provider, or blocked risk state is expected to remain visible; do not mark it healthy manually.

## Outages and worker recovery

- Database unavailable: fail closed, preserve the outage event, and restore database connectivity before retrying read-only work.
- Worker stale: inspect the durable `worker_leases` row, stop duplicate workers, and restart one worker with the same idempotent task policy. A local lifecycle object is not a durable heartbeat.
- Repeated failures: use bounded exponential backoff with jitter. Do not retry broker submissions.
- Unknown submission: preserve `submission_unknown` / `reconciliation_required`, query broker state through an approved reconciliation process, and never blindly resubmit.

## Alerts and incidents

Operational alerts are provider-independent. The current implementation records alert state in the additive schema and reports delivery as unavailable when no notifier is configured. Logged, deduplicated, delivered, and failed are distinct outcomes. Configure an approved notifier only in a later operations change with secret handling and delivery tests.

For discrepancies, risk blocks, emergency stops, or unsafe configuration, capture the correlation ID, preserve audit/log evidence, keep execution disabled, and escalate to the operator. Do not include credentials, cookies, authorization headers, session tokens, or database URLs in incident notes.

## Backups, migrations, rollback, and escalation

- Verify Neon backup/restore capability and retention in the provider console before applying future migrations. The current branch has been live-verified through migration 006 and read-only schema checks.
- Migrations are additive. Stop if a migration fails; do not delete rows or manually drop tables.
- Roll back application code to the previous known version only after confirming schema compatibility. Do not reverse migrations destructively without authorization.
- Escalate any unknown broker outcome, durable data discrepancy, credential exposure, or unexplained execution-state change immediately; preserve the database and logs for investigation.
