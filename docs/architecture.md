# Current architecture

The static dashboard and request-driven API retain the existing vanilla JavaScript/Cloudflare Workers architecture. `src/worker.js` maps Fetch requests to the same API handlers used by `server.js` locally. `src/index.html` is the Worker frontend; the root HTML remains the Node entry point.

## Authentication boundary

The official `@supabase/supabase-js` client is bundled locally into a generated browser asset. `/api/auth/config` exposes only the pinned project URL and public key. The browser uses official email/password sign-in, persisted sessions, automatic refresh, password recovery and sign-out. There is no registration UI. Supabase public signup must be disabled and operator access explicitly provisioned.

Every protected API obtains the bearer token, calls Auth `getUser(token)`, checks approved membership and an active `auth.sessions` record through a restricted database function, then uses a request-scoped Supabase Data API client authenticated with that user's JWT. Missing/invalid/expired sessions produce 401, verified users without approved access produce 403, and backend/configuration failures produce 503. Provider errors never include raw tokens, headers or database responses.

The session existence check closes the interval during which an otherwise unexpired Supabase JWT can outlive sign-out. Official Supabase sign-out removes the underlying session. No second session cookie or password authority is maintained. Access tokens are managed by the SDK in browser storage, so same-origin script integrity and the restrictive CSP remain essential.

## Persistence boundary

The Supabase adapter preserves domain repositories while routing their supported operations through the Data API and narrowly scoped RPCs. There is no arbitrary SQL-over-HTTP endpoint. Runtime uses a public key and the user's JWT, not a database password or service-role key. RLS ownership maps an approved Supabase Auth UUID to the existing local application user identity, preserving domain foreign keys during a reviewed data migration.

The existing domain schema includes application users, account settings, audit logs, analysis snapshots, proposals/decisions, risk records, historical simulation, paper records, execution reconciliation and operations supervision. Historical custom-password/session tables are retained only as source migration history; the running application does not authenticate against them. Do not erase or automatically import their credential/session records.

Before applying the Supabase migration, inspect the actual target schema, policies, data, grants and role definitions. The new migration and verification SQL are review artifacts and are never run at application startup. An existing schema is not assumed to match local migration history.

## Safety and deployment

Configuration rejects trading mode changes, live execution, background worker enablement, MT5 demo/connector use and MT5 execution. Pure simulation and adapter tests use isolated mocks. No API route submits an order.

The Worker uses Static Assets from `src/`; `src/.assetsignore` excludes the server entry point. `src/_headers` supplies frontend security headers, and API handlers return no-store JSON. The CSP connects only to the same origin and the intended Supabase project. Browser authorization uses bearer headers rather than authentication cookies; state-changing application APIs additionally enforce origin and authenticated request checks.

`wrangler.jsonc` pins the existing Worker name and compatibility date and commits public disabled-execution defaults. Dashboard-managed variables are preserved with `keep_vars`; the final HTTPS `APP_ORIGIN` and public project key must be verified in the Worker settings. Optional provider credentials remain encrypted server secrets.

See [the release runbook](runbooks/cloudflare-deployment.md) for external prerequisites and the approval boundary. Earlier milestone reports describe historical implementations, not the current active backend.
