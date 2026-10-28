# Supabase schema, RLS and data transition

These files prepare a local correction. No target schema, policy, account, or data has been changed. The active runtime now uses Supabase Auth and the Supabase Data API only. There is no Neon, Hyperdrive, direct PostgreSQL, password-hash, or custom-session fallback.

## Review the existing target before approving SQL

1. Open the existing `Yosemite_Ai_Bot` project and verify its reference is `txdjozotaxpthpnfikqx`.
2. Take the project's supported backup/snapshot and separately preserve the current schema, grants, RLS policies, migration ledger, row counts and owner mappings. Check the restore procedure before changing access policies.
3. Run `db/supabase-preflight.sql` in SQL Editor. It reads metadata only. Inspect the actual definitions and constraints against every file in `db/migrations`. If `schema_migrations` exists, inspect its definition and then read its ledger. A matching ledger does not by itself prove the schema matches.
4. Inventory existing views, functions, triggers and API exposure as well as tables. A preexisting SECURITY DEFINER function or owner-executed view may provide another data path; the migration does not automatically rewrite unrelated objects. Review grants and view security before approval.
5. Agree on the authoritative data source and the exact missing DDL. Do not run 001–007 over an existing schema merely because they use `IF NOT EXISTS`. That construct does not reconcile incompatible columns, constraints or data. Stop for an explicit migration design if a name or type conflicts.
6. Request approval for the exact SQL and the access-policy cutover before applying anything. Migration 008 changes grants and RLS, so it can disrupt an older deployed application. `npm run migrate` deliberately refuses to connect or apply changes.

When the domain schema is absent and that absence has been verified, the reviewed 001–007 files supply the required tables. When it is present, apply only reviewed missing definitions and reconcile the ledger after validation. Apply `008_supabase_auth_rls.sql` once after all required domain tables exist. Its transaction fails atomically on conflicts; do not remove guards or overwrite existing policies to force it through. Record the approved prior migrations in the target ledger only after verifying their actual schema effects.

## Existing data and identities

| Area | Tables | Runtime access |
| --- | --- | --- |
| Legacy identity | `app_users`, `auth_sessions` | Retained data; no direct Data API grants; passwords and sessions are unused |
| Auth membership | `yosemite_members` | Administrator-managed mapping only |
| Audit and risk | `audit_events`, `risk_evaluations` | Own rows only; own audit/risk inserts |
| Shared risk configuration | `risk_configurations` | Approved members can read; cannot write |
| Account and position state | `risk_daily_state`, `risk_account_snapshots`, `risk_position_snapshots` | No browser/Data API access |
| Proposals | `trade_proposals`, `trade_proposal_decisions` | Own rows; conditional, atomic decision RPC only |
| Simulation records | `backtest_runs`, `paper_events`, `paper_positions`, `paper_trades` | Own rows, read only; simulation stays disabled |
| Execution records | `execution_intents`, `execution_transitions` | Own rows, read only; execution stays disabled |
| Operations | `operational_alerts`, `worker_leases`, `recovery_tasks` | No browser/Data API access |
| Limiting and migrations | `rate_limit_buckets`, `schema_migrations` | Scoped limiter RPC only; ledger administrator only |

`yosemite_members.app_user_id` maps an invited Supabase Auth UID to the existing `app_users.id`. Every domain foreign key retains the old ID. Do not replace those IDs with Auth UUIDs, remap ownership based on a browser field, or automatically associate users by an unverified email address. Old password hashes and custom sessions remain inert and inaccessible through the Data API; no cleanup or deletion is required for this repair.

If required records exist only in the former Neon database, transfer is still an approved operator task. First inventory source and target schemas, migration histories, exact row counts and all primary/foreign keys. Export through a protected database tool outside the repository; never place connection strings, database dumps or password hashes in Git. Prepare an explicit conflict report for each table, including any ID collision. Copy only reviewed missing domain records, in foreign-key order and in transactions, retaining all owner IDs and timestamps. Do not overwrite target rows, truncate tables, or reactivate old password/session records. Validate row counts, representative records, foreign keys and ownership against both sources before cutover. Keep the prior source intact for recovery; the corrected application never connects to it.

## Provision the authorized operator after approval

Disable **Authentication → Sign In / Providers → Allow new users to sign up**, and disable anonymous sign-ins. Invite the intended operator through **Authentication → Users → Invite user**; verify the email/identity and record that user's Auth UID privately. There is no public registration UI or registration endpoint. An Auth account alone does not grant dashboard access.

For existing domain data, find the intended legacy user without selecting password hashes:

```sql
SELECT id, username FROM public.app_users ORDER BY created_at;
```

After verifying that ownership with the operator, insert the mapping with the reviewed IDs:

```sql
INSERT INTO public.yosemite_members (auth_user_id, app_user_id, enabled, role)
VALUES ('<invited Auth UUID>', '<verified existing app_users.id>', true, 'operator');
```

If this is a verified new installation with no legacy application user, create one inert domain identity first. The legacy `password_hash` column is NOT NULL; its fixed marker below is neither a password nor a usable password hash. No code authenticates against it.

```sql
BEGIN;
INSERT INTO public.app_users (id, username, password_hash)
VALUES ('<new UUID generated for the domain user>', 'operator',
        'SUPABASE_AUTH_MANAGED_NO_LOCAL_PASSWORD');
INSERT INTO public.yosemite_members (auth_user_id, app_user_id, enabled, role)
VALUES ('<invited Auth UUID>', '<the same new domain UUID>', true, 'operator');
COMMIT;
```

Do not use an automatic upsert for mapping: a conflict needs review rather than reassignment of another user's data. The membership table enforces one Auth UID per legacy owner. Leave every unapproved account unmapped or `enabled=false`. To remove dashboard authorization without deleting data, an approved administrator can set that mapping's `enabled=false`; both API session checks and RLS then deny access.

## What migration 008 enforces

Every named application table has RLS. Restrictive ownership policies remain effective alongside preexisting permissive policies, and inherited PUBLIC/anon/authenticated grants are reset for those named tables. Legacy identity, operational state, account snapshots and membership are denied to Data API clients. Per-user tables map `auth.uid()` through approved membership. Child records also check their parent ownership.

`yosemite_session_context()` checks the signed JWT's `session_id` against `auth.sessions`. It reports active-but-unapproved membership separately from a missing/revoked session, allowing API 403 and 401 responses respectively. The `not_after` lifetime, when present, is checked too. Supabase sign-out deletes the affected Auth session, so an otherwise unexpired access JWT loses both Worker API access and protected Data API access immediately. API identity is also verified with the official Auth service before this RPC.

`yosemite_rate_limit()` accepts a hash, action and bounded window and prefixes the key with the authenticated Auth UID. It atomically updates only that user's limiter buckets; no general SQL execution RPC exists. `yosemite_transition_proposal()` derives its actor from membership and conditionally changes an owned, unexpired, pending proposal only when the supplied digest matches. Approval also requires stored PASS risk and trade parameters; the decision row is inserted atomically. Direct proposal INSERT/UPDATE grants are deliberately absent: browser clients must not manufacture trusted proposals or bypass approval logic. The existing application has no active trusted proposal-creation pipeline. Any future pipeline needs a separately reviewed server-only writer and gate checks.

All helper functions use a fixed empty search path, fully qualified tables, and restricted EXECUTE grants. No service-role key, Auth admin key, database password or privileged binding is required by the runtime.

## Verification after the approved cutover

Run `npm run verify` locally before deployment. `tests/supabase-rls.test.mjs` executes all eight migrations against local PGlite PostgreSQL with synthetic Auth tables/claims. It verifies ownership on real SQL queries, denial with preexisting permissive policies/PUBLIC grants, atomic decisions, scoped limiter operations, unapproved users, missing/revoked/time-expired sessions and anonymous access. It proves the prepared SQL's behavior in isolation; it does not prove the existing target schema or deployment configuration matches.

After the SQL, invitation and configuration have been approved/applied, verify in the actual target with test users and synthetic domain records only: approved operator sign-in; refresh; access-token renewal; sign-out and replay of the former JWT; an Auth user with no membership; two distinct approved owners; expired/malformed JWTs; and a temporary provider/network failure. Confirm that no request reveals another owner's rows and that database/RLS failures return availability errors rather than invalid-password errors. Keep all trading/worker/demo/broker flags disabled throughout. Do not run broker connections or orders.

Official references: [Supabase sessions and immediate sign-out checks](https://supabase.com/docs/guides/auth/sessions), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [JavaScript RPC](https://supabase.com/docs/reference/javascript/rpc).
