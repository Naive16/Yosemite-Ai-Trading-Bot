# Serverless readiness fixes report

## Implementation

1. Replaced process-local login, market-data, AI, risk, strategy, backtest, and paper request buckets with a shared PostgreSQL rate-limit layer in `api/_lib/rate-limit.js`.
2. Added additive migration `db/migrations/007_rate_limit_buckets.sql` with UTC-compatible `timestamptz` fields, a non-negative count constraint, and an expiry index.
3. Used parameterized, atomic `INSERT ... ON CONFLICT DO UPDATE` operations. Request limiters consume one bucket count atomically; login checks the current failure count and records only failed credentials, preserving the existing login semantics.
4. Added bounded cleanup of rows expired for more than one day, attempted at most once per process minute. No persistent worker is required for the limiter.
5. Sensitive routes return safe unavailable responses when the shared limiter database operation fails. No in-memory fallback remains for enforcement.
6. Updated `vercel.json` from `api/*.js` to `api/**/*.js` and added a local route-coverage test for nested authentication/private directories.

## Tests and verification

- `npm run verify` — final result: 83 tests passed, 0 failed, 0 skipped, 0 cancelled.
- Focused rate-limit, authentication, database, deployment, routing, security, market-data, risk, and simulation tests — passed.
- Concurrent shared limiter test — passed: five concurrent calls produced three allowed and two limited results for a limit of three.
- Expiration test — passed: an expired bucket resets to an allowed first request.
- Backend failure test — passed: limiter database failure raises a safe `RateLimitUnavailableError`; protected handlers map it to an unavailable response.
- Migration test — passed: migration 007 is additive, constrained, and expiry-indexed.
- `npm run deployment-check` — expected local failure because production environment variables and HTTPS origin are not present in the current process environment; it also warns that migration 007 must be applied and verified. No secrets were printed.
- No build or lint scripts exist in `package.json`.

## Remaining blockers and unverified items

- Migration 007 has not been applied to Neon. The application must not be considered ready until the migration is reviewed and run through an authorized direct Neon migration event.
- Real cross-instance behavior and PostgreSQL concurrency were tested only with the deterministic fake database. Live Neon verification was intentionally not performed.
- Vercel route discovery was verified only from the local recursive configuration and route enumeration test. A Vercel preview is still required to confirm deployment behavior.
- Git metadata, Vercel project/origin, production secret storage, and post-deployment smoke tests remain unavailable.
- Rate-limit cleanup is request-driven and bounded by the one-day retention condition; a future operations policy may add an explicitly authorized scheduled cleanup if required by workload.

## Safety confirmation

No Neon connection, remote migration, Vercel deployment, Git operation, paid-service action, broker connection, MT5 execution, trading activation, or background worker activation occurred. Trading remains disabled.
