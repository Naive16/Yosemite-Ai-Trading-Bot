> Historical milestone record. The active backend is now Supabase Auth and Data API. Use [the current release runbook](../runbooks/cloudflare-deployment.md); legacy Neon/custom-password instructions below are not current deployment guidance.

# Milestone 11 Report — Cloud Worker Deployment Investigation

## Status and boundary

Milestone 11 is complete as an evidence-based local investigation. No cloud resource was provisioned, no account was created, no broker or MT5 terminal was installed, and no live or demo order path was enabled. Trading remains disabled by default. Milestone 12 was not started.

The investigation was checked against official documentation on 2026-10-22. “Free” below means the provider’s current documented tier and constraints, not a guarantee of permanent availability, capacity, or zero operational risk.

## Repository audit

Inspected:

- `README.md`, `docs/architecture.md`, and Milestone 1–10 reports.
- `vercel.json`, `package.json`, and the existing serverless API layout.
- `api/_lib/config.js`, database adapter/repository, authentication/session/CSRF controls, risk engine, proposal workflow, backtest engine, paper simulator, and protected API routes.
- `db/migrations/001_initial_schema.sql` through `004_paper_backtest.sql`.
- Existing focused tests and the deterministic fake database.

The existing architecture is request-driven Vercel-compatible JavaScript with server-side Neon access. No worker entry point, durable worker heartbeat, job queue, or broker adapter existed before this milestone.

## Safe implementation

Added only deployment groundwork that can be tested locally without credentials:

- `api/_lib/config.js` now validates disabled-by-default worker settings: `WORKER_ENABLED`, `WORKER_ID`, `WORKER_HEARTBEAT_INTERVAL_SECONDS`, `WORKER_POLL_INTERVAL_SECONDS`, and `WORKER_MAX_BACKOFF_SECONDS`. Explicit worker enablement requires `DATABASE_URL`.
- `api/_lib/worker/lifecycle.js` provides a pure lifecycle contract for start, heartbeat freshness, duplicate job IDs, graceful stop, and an always-false `executionAllowed` value.
- `tests/worker.test.mjs` covers safe startup configuration, missing database configuration, duplicate jobs, stale heartbeats, and graceful shutdown.
- `package.json` includes the new worker helper in syntax verification.
- `README.md` and `docs/architecture.md` describe the disabled-by-default, non-durable status and the future worker boundary.

This is not a persistent worker. It does not write heartbeats, poll a queue, reconcile jobs, connect to a broker, or guarantee uptime. It is a contract for later implementation, not a deployment.

## Hosting candidates and official evidence

### Render

Render documents free Static Sites and Web Services, but its free-service page says other service types do not support Free instances. Background Workers are documented as continuously running services, while the free page limits Free instances to web services, static sites, Postgres, and Key Value. Free web services spin down after 15 minutes without inbound traffic, can take about a minute to start, may restart, have ephemeral filesystems, cannot scale beyond one instance, and receive 750 free instance-hours per workspace/month. Render’s free Postgres is documented as 1 GB and expires after 30 days; free Key Value is in-memory and loses state on restart.

Conclusion: suitable for limited web-service experiments, not a reliable $0 persistent worker. The free worker requirement is not met.

Official sources checked 2026-10-22:

- [Render Deploy for Free](https://render.com/docs/free)
- [Render Background Workers](https://render.com/docs/background-workers)
- [Render Pricing](https://render.com/pricing)

### Vercel

Vercel is a good fit for the current static frontend and request-driven protected API. Its official Functions documentation describes functions as request-triggered server-side code that scale per invocation. Current limits document bounded function durations rather than an indefinitely running process; the limits page also states that Vercel Functions do not act as WebSocket servers. Cron or scheduled invocation is not equivalent to a continuously running worker and cannot be treated as an uptime guarantee.

Conclusion: retain Vercel-style hosting for the frontend/API if selected, but do not put a persistent trading or paper worker in a function. The current repository’s `vercel.json` remains unchanged.

Official sources checked 2026-10-22:

- [Vercel Functions](https://vercel.com/docs/functions)
- [Vercel Function Limits](https://vercel.com/docs/functions/limitations)
- [Vercel Limits](https://vercel.com/docs/limits)
- [Deploying to Vercel](https://vercel.com/docs/deployments/overview)

### Neon PostgreSQL

Neon remains the intended durable store and is not a worker host. The current Neon pricing page documents a Free plan at $0/month with no credit card required, 100 CU-hours per project/month, 1 GB storage per project, and compute scale-to-zero after five minutes of inactivity. Scale-to-zero is appropriate for durable state but creates cold-start behavior and does not provide process supervision, a queue consumer, or continuous execution.

Conclusion: keep Neon as the single database. A future worker must use the existing pooled application URL for normal queries and the direct URL for migrations, obey connection/timeouts, and store durable heartbeats/jobs there. No migration was added in this milestone because no durable worker contract is being activated yet.

Official sources checked 2026-10-22:

- [Neon Pricing](https://neon.com/pricing)
- [Neon Scale to Zero](https://neon.com/docs/introduction/scale-to-zero)
- [Neon Connection Pooling](https://neon.com/docs/connect/connection-pooling)

### Oracle Cloud Always Free

Oracle documents Always Free compute resources in the account home region, including up to two AMD micro VMs or an Ampere A1 allocation equivalent to 2 OCPUs and 12 GB memory, subject to capacity and tenancy limits. Oracle also documents card/debit-card verification at signup, possible temporary authorization holds, no SLA for Always Free-only accounts, home-region restrictions, out-of-capacity errors, and suspension/termination risk for idle accounts.

Conclusion: OCI is the most plausible $0 host for a separate Linux paper-data worker, but availability, card requirement, region capacity, account lifecycle, and operational supervision remain external prerequisites. It is not proof of MT5 compatibility. No OCI account or VM was created.

Official sources checked 2026-10-22:

- [Oracle Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Oracle Cloud Free Tier FAQ](https://www.oracle.com/cloud/free/faq/)
- [Oracle Free Tier signup](https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-Sign_Up_for_Free_Oracle_Cloud_Promotion.htm)

## MT5 compatibility assessment

| Claim | Status | Evidence and interpretation |
|---|---|---|
| MT5 terminal runs on Windows 10/11 | VERIFIED from vendor documentation | MetaTrader’s installation documentation explicitly lists Windows 10/11. |
| Python package communicates with a running MT5 terminal | VERIFIED from vendor documentation | MQL5 documents `initialize`, `login`, `shutdown`, quote/history functions, and `order_send` through interprocess communication with the terminal. |
| MT5 can run on Linux using Wine | DOCUMENTED, operational reliability UNVERIFIED | MetaTrader publishes a Linux/Wine installation path and recommends current Wine, but that does not prove unattended broker-terminal reliability for this project. |
| Python/MT5 integration is reliable on an arbitrary free Linux VM | UNVERIFIED | No controlled OCI/Render/other-host test was performed; broker terminal behavior, Wine, display/session behavior, restarts, and time synchronization were not validated. |
| MT5 worker is suitable for Vercel Functions | UNSUPPORTED for this architecture | Vercel functions are bounded request invocations, not a persistent terminal process. |
| MT5 worker is suitable for Render Free | UNSUPPORTED for the required persistent-worker boundary | Render’s free service types exclude background workers, and free web services sleep/restart. |
| MT5 worker is suitable for OCI Always Free | UNVERIFIED | A VM may be available, but Windows image/licensing, terminal installation, broker login, Wine/Python behavior, supervision, and recovery were not tested. |

The official Python documentation’s examples use Python on Windows and require a terminal connection. MT5 broker credentials must remain isolated to a dedicated account/session, and any future worker must disable algorithmic trading until separately authorized. No MT5 binary was downloaded or installed.

Alternative broker REST/WebSocket APIs could avoid the terminal and Wine dependency, but would require a new provider adapter, broker-specific authentication, order semantics, reconciliation, symbol/specification mapping, and a separate verification program. That work is outside Milestone 11 and does not justify enabling execution now.

Official sources checked 2026-10-22:

- [MetaTrader 5 installation](https://www.metatrader5.com/en/terminal/help/start_advanced/installation)
- [MetaTrader 5 installation on Linux](https://www.metatrader5.com/en/terminal/help/start_advanced/install_linux)
- [MQL5 Python Integration](https://www.mql5.com/en/docs/python_metatrader5)
- [MQL5 Python login](https://www.mql5.com/en/docs/python_metatrader5/mt5login_py)

## Recommended architecture

1. Keep the current browser dashboard and protected APIs request-driven. Keep credentials server-side and preserve authentication, CSRF, authorization, the independent risk engine, explicit approval, audit events, and emergency-stop behavior.
2. Keep Neon as the only database. Add a future additive worker migration only after the worker contract is approved. It should include worker identity, lease/heartbeat timestamps, job state, idempotency keys, attempts, next-attempt time, and terminal outcomes with UTC timestamps and constraints.
3. Run any future worker as a separate process, not inside a Vercel function. It should acquire a lease transactionally, heartbeat at a bounded interval, use exponential backoff, release connections on shutdown, and reconcile `running`/unknown jobs after restart before accepting new work.
4. Separate health dimensions: process health, recent durable heartbeat, database connectivity, market-data freshness, queue/job state, and trading readiness. A liveness endpoint or scheduled call must not mark the worker healthy without a recent validated database heartbeat.
5. Fail closed on database/provider outages, stale heartbeats, ambiguous execution outcomes, missing specifications, invalid approval digests, or disabled trading. Never replay unknown work blindly.
6. Use server-side environment variables or a host secret manager. Do not place broker credentials in browser bundles, source, logs, or reports.
7. For a $0 investigation path, OCI Always Free is only a candidate for a non-MT5 paper worker after account/region availability is confirmed. For reliable MT5 operation, a supported Windows environment would need a controlled test and may require paid infrastructure; the project should not assume $0 until proven.

## Estimated recurring cost

- Current local implementation: $0; no external service was provisioned.
- Vercel frontend/API: potentially $0 within the current free allowance, subject to plan limits and future pricing/usage changes; not a worker host.
- Neon Free: currently documented as $0/month with quota and scale-to-zero limits; no live project was verified in this milestone.
- Render Free: $0 for eligible services, but not suitable for a persistent free background worker; free Postgres has a documented 30-day expiration.
- OCI Always Free: $0 for eligible resources for the life of the account, subject to card verification, region capacity, account rules, and service limits; no SLA and no guarantee of availability.
- MT5/broker operation: unknown and excluded. Potential Windows VM, broker, market-data, monitoring, network, and licensing charges are not included.

## Security and operational risks

- A heartbeat without durable storage is not evidence of worker health; the new lifecycle helper intentionally cannot make that claim.
- Serverless restarts and Neon scale-to-zero can create cold starts and duplicate work unless leases and idempotency are persisted.
- Provider outages, stale quotes, database timeouts, process crashes, and unknown broker outcomes must block rather than retry blindly.
- Free tiers can sleep, restart, suspend, expire, or run out of capacity. Free services are not production SLOs.
- MT5 through Wine may work, but unattended reliability with a specific broker and host is unverified.
- Current in-memory rate limiters remain instance-local; a production worker/API deployment needs a shared atomic limiter or managed equivalent.

## Tests and external checks

Command run:

```text
npm run verify
```

Observed result: JavaScript syntax checks passed; `59` tests passed, `0` failed, `0` skipped, and `0` cancelled.

Local deterministic checks covered worker configuration, missing database configuration, heartbeat staleness, duplicate job handling, graceful shutdown, disabled execution, and all existing Milestone 1–10 regressions. Official documentation was reviewed online on 2026-10-22. No real Vercel, Render, Neon, Oracle, MT5, broker, or external worker check was performed.

## Remaining blockers and Milestone 12 recommendations

- Choose and obtain explicit approval for a worker host after confirming account eligibility, region, card requirements, quotas, and cost controls.
- Decide whether the next milestone is a non-MT5 paper worker or a controlled MT5 compatibility experiment; do not combine that with live execution.
- Add durable worker heartbeat/lease/job migrations only when the worker contract is approved.
- Test restart recovery, database outage, provider outage, time drift, process supervision, and unknown outcomes on the chosen host.
- Keep live and demo execution disabled until a separate approved milestone validates the full broker path.

Milestone 11 stops here. No Milestone 12 implementation was started.
