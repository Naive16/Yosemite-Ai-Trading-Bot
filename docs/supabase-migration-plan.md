# Yosemite AI — Neon to Supabase Backend Migration Plan & Runbook

This document captures the Phase 1 architectural audit, Phase 2 local Supabase PostgreSQL implementation, and Phase 3 reviewed, repeatable, non-destructive Neon-to-Supabase data migration procedure.

No remote Neon query, remote Supabase DDL, remote account modification, or hosted deployment has been executed automatically.

---

## 1. Architecture Summary

Supabase serves as Yosemite AI's **single unified backend platform** for both:
1. **Owner Authentication (`api/_lib/supabase.js`)**: Server-side Email + Password verification (`POST /auth/v1/token?grant_type=password` + independent `GET /auth/v1/user`), confirmed-email check, immediate upstream token logout (`POST /auth/v1/logout?scope=local`), and constant-time single-owner enforcement (`SUPABASE_OWNER_USER_ID`) on login and every protected route.
2. **PostgreSQL Persistence (`api/_lib/database.js`)**: Server-side PostgreSQL wire-protocol connection via `pg` (`node-postgres`) over TLS:
   - **Runtime (`DATABASE_URL`)**: Supabase **Supavisor Transaction Mode (`:6543`)** (`postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require`). Uses transient per-operation `pg.Client` connections in Cloudflare Workers (`workerd` request-scoped socket isolation) and a bounded `pg.Pool` (`max: 5`) in Node.js (`server.js`).
   - **Migrations (`DIRECT_URL` / `DATABASE_URL_UNPOOLED`)**: Supabase **Supavisor Session Mode (`:5432`)** (`aws-0-<region>.pooler.supabase.com:5432`, free IPv4 + IPv6 compatible — **no paid Supabase IPv4 add-on required**) or **Direct Connection (`:5432`)** (`db.<project-ref>.supabase.co:5432` on IPv6 networks).
   - **Zero browser credentials / zero service-role keys**: Browser code remains `default-src 'self'` with opaque `HttpOnly; SameSite=Lax` `yosemite_session` cookies and HMAC `X-CSRF-Token` validation. `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `sb_secret_*`, and `service_role` JWTs are hard-rejected by `api/_lib/config.js`.

---

## 2. Neon-Specific Assumptions Replaced

| Area | Legacy Neon Assumption | Supabase Replacement |
| --- | --- | --- |
| Driver (`package.json`, `api/_lib/database.js`) | `@neondatabase/serverless` (`neon()` proprietary HTTPS `/sql` endpoint, incompatible with Supabase hosts) | `pg` (`^8.23.1`) standard PostgreSQL extended-query wire protocol (unnamed statements compatible with Supavisor `:6543` and `:5432`) |
| Worker socket lifecycle (`api/_lib/database.js`) | Module-cached Neon HTTP function | Runtime-aware client: transient `pg.Client` per operation on Cloudflare Workers (`workerd`); bounded `pg.Pool` on Node.js; explicit `db.transaction()` support |
| Pooler detection (`scripts/migrate.mjs`, `api/_lib/deployment.js`) | Checked `hostname.includes("-pooler")` and `sql.transaction([...sql.unsafe(...)])` | Rejects transaction poolers (`:6543`, `pgbouncer=true`, `-pooler.`) and legacy `*.neon.tech` hosts; supports Supabase Session Mode (`:5432`) + Direct (`:5432`) and dollar-quoted `DO $rls$ ... $rls$;` SQL |
| Public schema exposure (`db/migrations/008_supabase_rls_hardening.sql`) | Neon had no PostgREST endpoint exposing `public.*` | Migration `008` enables Row Level Security across all **21** `public` tables, revokes `PUBLIC`/`anon`/`authenticated` table privileges, and installs restrictive + owner-UUID defense-in-depth policies |

---

## 3. Complete Table, Constraint, Index & RLS Mapping (Migrations `001`–`008`)

All 21 tables in `public` use standard PostgreSQL types (`text`, `integer`, `numeric`, `boolean`, `date`, `timestamptz`, `jsonb`), constraints, and indexes that run unchanged on Supabase PostgreSQL:

| Migration | Table | Primary Key / Key Constraints & Indexes | RLS & PostgREST Posture (`008`) | Data Migration Policy |
| --- | --- | --- | --- | --- |
| `001` | `schema_migrations` | `version` PK | RLS ON; restrictive deny `anon`/`authenticated` | Rebuilt by `npm run migrate` (`000001`–`000008`) |
| `001` | `app_users` | `id` PK, `username` UNIQUE | RLS ON; deny `anon`; owner `id = jwt.sub` SELECT | Canonical single row (`id = SUPABASE_OWNER_USER_ID`) |
| `001` | `auth_sessions` | `token_hash` PK, FK `app_users(id) ON DELETE CASCADE`, partial active expiry idx | RLS ON; restrictive deny `anon`/`authenticated` | **Skip** (ephemeral 30m session hashes; fresh login post-cutover) |
| `001` | `audit_events` | `id` PK, FK `app_users(id) ON DELETE SET NULL`, `jsonb` object check | RLS ON; deny `anon`; owner `user_id = jwt.sub` SELECT | **Preserve** (remap legacy owner `user_id` -> `SUPABASE_OWNER_USER_ID`; keep `NULL` system events) |
| `002` | `risk_configurations` | `version` PK, partial unique index `WHERE active` | RLS ON; restrictive deny `anon`/`authenticated` | **Preserve** |
| `002` | `risk_daily_state` | `trading_day_key` PK (`date`) | RLS ON; restrictive deny `anon`/`authenticated` | **Preserve** |
| `002` | `risk_account_snapshots` | `id` PK, `captured_at DESC` idx | RLS ON; restrictive deny `anon`/`authenticated` | **Preserve** |
| `002` | `risk_position_snapshots` | `id` PK, `direction IN ('BUY','SELL')` | RLS ON; restrictive deny `anon`/`authenticated` | **Preserve** |
| `002` | `risk_evaluations` | `id` PK, FK `app_users(id) ON DELETE SET NULL`, FK `risk_configurations(version)` | RLS ON; deny `anon`; owner `user_id = jwt.sub` SELECT | **Preserve** (remap legacy owner `user_id`) |
| `003` | `trade_proposals` | `(id, version)` PK, `UNIQUE (id, version, content_digest)` | RLS ON; deny `anon`; owner `user_id = jwt.sub` SELECT | **Preserve** (remap `user_id`) |
| `003` | `trade_proposal_decisions` | `id` PK, composite FK `(proposal_id, proposal_version)` -> `trade_proposals` | RLS ON; deny `anon`; owner `actor_user_id = jwt.sub` SELECT | **Preserve** (remap `actor_user_id`) |
| `004` | `backtest_runs` | `id` PK, FK `app_users(id) ON DELETE CASCADE` | RLS ON; deny `anon`; owner `user_id = jwt.sub` SELECT | **Preserve** (remap `user_id`) |
| `004` | `paper_events` | `event_id` PK, FK `app_users(id) ON DELETE CASCADE` | RLS ON; deny `anon`; owner `user_id = jwt.sub` SELECT | **Preserve** (remap `user_id`) |
| `004` | `paper_positions` | `id` PK, `CHECK (simulated = true)` | RLS ON; deny `anon`; owner `user_id = jwt.sub` SELECT | **Preserve** (remap `user_id`) |
| `004` | `paper_trades` | `id` PK, FK `paper_positions(id)`, `CHECK (simulated = true)` | RLS ON; deny `anon`; owner `user_id = jwt.sub` SELECT | **Preserve** (remap `user_id`) |
| `005` | `execution_intents` | `id` PK, `idempotency_key` UNIQUE, `(proposal_id, proposal_version, content_digest)` UNIQUE | RLS ON; deny `anon`; owner `user_id = jwt.sub` SELECT | **Preserve** (remap `user_id`) |
| `005` | `execution_transitions` | `id` PK, FK `execution_intents(id) ON DELETE CASCADE` | RLS ON; restrictive deny `anon`/`authenticated` | **Preserve** |
| `006` | `operational_alerts` | `id` PK, `alert_key` UNIQUE, partial active idx | RLS ON; restrictive deny `anon`/`authenticated` | **Preserve** |
| `006` | `worker_leases` | `worker_id` PK | RLS ON; restrictive deny `anon`/`authenticated` | **Skip** (ephemeral heartbeat state; `WORKER_ENABLED=false`) |
| `006` | `recovery_tasks` | `id` PK, `idempotency_key` UNIQUE | RLS ON; restrictive deny `anon`/`authenticated` | **Preserve** |
| `007` | `rate_limit_buckets` | `bucket_key` PK, `expires_at` idx | RLS ON; restrictive deny `anon`/`authenticated` | **Skip** (ephemeral rate-limit windows) |

---

## 4. Reviewed, Repeatable Migration Procedure (Execute Only After Explicit Approval)

### Step 1 — Pre-Migration Checklist (No Destructive Actions)
1. Confirm your existing Supabase project has Email + Password enabled, public sign-ups disabled, and your single confirmed owner user created (`SUPABASE_OWNER_USER_ID`).
2. Retrieve your Supabase **Supavisor Session Mode (`:5432`)** connection string as `DIRECT_URL` and **Supavisor Transaction Mode (`:6543`)** connection string as `DATABASE_URL` from **Supabase Dashboard -> Connect -> Connection String**.
3. Keep the existing Neon database untouched as a read-only fallback snapshot until post-cutover verification succeeds.

### Step 2 — Apply Additive Schema & RLS Migrations (`001`–`008`) on Supabase
With `DIRECT_URL` pointing to Supabase (`:5432`), run:

```bash
DIRECT_URL="postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require" npm run migrate
```

Expected output: `Applied migration 000001` through `Applied migration 000008`. Verify in Supabase **Database -> Advisors -> Security Advisor** that `0` public tables lack RLS.

### Step 3 — Dry-Run Existing Neon Data Inspection (`BEGIN READ ONLY` on Neon)
`scripts/migrate-neon-to-supabase.mjs` opens the Neon source connection inside a PostgreSQL `BEGIN READ ONLY` transaction so Neon cannot be modified, overwritten, or dropped. Run dry-run first (no `--execute` flag):

```bash
NEON_SOURCE_DATABASE_URL="<existing-neon-direct-or-pooled-url>" \
SUPABASE_TARGET_DIRECT_URL="<supabase-session-mode-5432-url>" \
SUPABASE_OWNER_USER_ID="<your-supabase-owner-uuid>" \
SUPABASE_OWNER_EMAIL="<your-owner-email>" \
npm run migrate:data:dry-run
```

Review the JSON summary (`sourceUserCount`, `legacyUserRemapped`, per-table `sourceRows`). If all durable tables have `sourceRows: 0`, no data copy is required; otherwise proceed to Step 4.

### Step 4 — Execute Idempotent Transactional Data Copy (If Neon Has Durable Records)
Run with `--execute`:

```bash
NEON_SOURCE_DATABASE_URL="<existing-neon-direct-or-pooled-url>" \
SUPABASE_TARGET_DIRECT_URL="<supabase-session-mode-5432-url>" \
SUPABASE_OWNER_USER_ID="<your-supabase-owner-uuid>" \
SUPABASE_OWNER_EMAIL="<your-owner-email>" \
node scripts/migrate-neon-to-supabase.mjs --execute
```

All inserts run inside a single `BEGIN ... COMMIT` transaction on Supabase in FK dependency order using `ON CONFLICT DO NOTHING`, remapping any single-owner legacy `user_id` / `actor_user_id` to `SUPABASE_OWNER_USER_ID` and verifying row counts before commit. Re-running the command is safe and inserts `0` duplicates.

### Step 5 — Cutover & Rollback Safety
1. Update encrypted server-side `DATABASE_URL` (`:6543`), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_OWNER_USER_ID`, and `SESSION_SECRET` in local `.env` / deployment secrets; keep `TRADING_MODE=disabled`, `LIVE_TRADING_ENABLED=false`, `WORKER_ENABLED=false`, and `MT5_EXECUTION_ENABLED=false`.
2. Run `npm run deployment-check` with production environment variables loaded (`Deployment preflight passed. No secrets were printed.`).
3. Verify `/api/health`, owner login, `/api/auth/me`, `/api/private/operations` (`database.state === "healthy"`), CSRF protection, and logout revocation.
4. **Rollback**: Because Neon is never modified or deleted during migration, rolling back prior to any post-cutover state divergence only requires restoring the previous application version and secret configuration.
