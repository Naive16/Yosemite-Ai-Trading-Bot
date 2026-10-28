> Historical milestone record. The active backend is now Supabase Auth and Data API. Use [the current release runbook](../runbooks/cloudflare-deployment.md); legacy Neon/custom-password instructions below are not current deployment guidance.

# Milestone 3 report — Neon PostgreSQL persistence

## Status

Completed for the approved Milestone 3 scope. Live Neon verification was not performed because no Neon credentials or database were available.

## Repository inspection

- Re-read the Milestone 1 and Milestone 2 implementation before editing.
- Confirmed the existing dashboard, authentication flow, health endpoint, and tests were present.
- Re-ran the existing verification before beginning the database work.
- Preserved all existing dashboard behavior, security controls, and passing tests.
- Added `@neondatabase/serverless` as the only runtime dependency; installation completed with 0 reported vulnerabilities.

## Implemented

- Server-only Neon configuration for pooled `DATABASE_URL` application traffic and direct `DATABASE_URL_UNPOOLED` migration traffic.
- Validated PostgreSQL URLs, production database requirements, and bounded database query timeouts.
- Added a lazily initialized Neon serverless HTTP database client with safe error normalization and timeout handling.
- Added additive migration `001_initial_schema.sql` containing:
  - `schema_migrations`
  - `app_users`
  - `auth_sessions`
  - `audit_events`
  - foreign keys, checks, indexes, and UTC-capable `timestamptz` timestamps
- Added a migration runner that refuses pooled URLs and does not run destructive statements.
- Replaced in-memory session validation with database-backed session lookup and revocation.
- Stores only HMAC-derived session and CSRF hashes, not raw session secrets.
- Persists the configured single-user account on authentication.
- Persists successful logins, failed logins, and logout events.
- Preserved the existing in-memory login rate limiter and documented that it is not multi-instance safe.

## Files changed

- `.env.example`
- `package.json`
- `package-lock.json`
- `README.md`
- `docs/architecture.md`
- `docs/milestones/milestone-3-report.md`
- `api/_lib/config.js`
- `api/_lib/database.js`
- `api/_lib/repository.js`
- `api/_lib/auth.js`
- `api/auth/login.js`
- `api/auth/me.js`
- `api/auth/logout.js`
- `api/private/status.js`
- `db/migrations/001_initial_schema.sql`
- `scripts/migrate.mjs`
- `tests/auth.test.mjs`
- `tests/database.test.mjs`
- `tests/support/fake-database.mjs`

## Validation performed

Executed from the repository root:

```text
npm run verify
```

Observed result: passed. JavaScript syntax checks passed and 14 tests passed with 0 failures, 0 skipped, and 0 cancelled.

The tests cover configuration validation, additive migration content, parameterized query behavior, normalized database failures, query timeouts, durable account/session/audit behavior through a fake database, simulated serverless-instance session validation, session expiry, logout/revocation, preserved authentication behavior, and preserved Milestone 1 health behavior.

Also executed:

```text
npm run migrate
```

Observed result: safely stopped with exit code 1 because `DATABASE_URL_UNPOOLED` or a direct `DATABASE_URL` was not available. No database connection was attempted and no migration was applied.

An additional high-confidence credential scan outside documentation/templates found no credential-like literals.

Not performed: live Neon connection, live migration application, browser deployment, database performance testing, broker connectivity, Claude calls, worker execution, or comprehensive trading tests.

## Security and trading-safety impact

- Database credentials remain server-only and are absent from browser code.
- Session validation and revocation are durable across simulated serverless instances.
- Invalid database configuration and database failures return safe generic responses instead of exposing connection details.
- No destructive migration was run and no existing data was deleted.
- Live trading, demo trading, brokers, and order execution remain disabled.

## Rate-limiter review

The existing login limiter remains process-local. It does not provide protection across multiple serverless instances or after instance replacement. The safe production path is a shared atomic limiter, such as a Neon counter/window table using an atomic upsert or a dedicated managed rate-limit service. Authentication should fail closed if that shared limiter is unavailable. This limitation is documented and is not falsely represented as solved by the new session database.

## Costs and hosting

- No Neon project, branch, database, or paid service was provisioned.
- No migration was applied.
- No paid resource was activated.

## Outstanding issues

- Live Neon credentials and a user-authorized database branch are required to verify connectivity and apply the migration.
- The current rate limiter is not multi-instance safe.
- Database-backed authentication is not production-ready until live migration verification, deployment configuration, operational monitoring, and a shared rate-limiting strategy are completed.

## Next milestone

Milestone 4 — Responsive trading dashboard. It has not been started.
