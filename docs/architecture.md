# Current architecture

The static dashboard and request-driven API retain the existing vanilla JavaScript/Cloudflare Workers architecture. `src/worker.js` maps Fetch requests to the same API handlers used by `server.js` locally. `src/index.html` is the Worker frontend; the root HTML remains the Node entry point.

## Authentication boundary

There is no browser sign-in, sign-up, recovery, or sign-out UI: the dashboard loads directly and refresh goes straight to the dashboard. Private access for the deployed application is enforced at the Cloudflare Access edge; every `/api/private/*` handler additionally verifies a bearer session server-side (Auth `getUser(token)`, approved membership, and an active `auth.sessions` record through a restricted database function) and fails closed — missing/invalid/expired sessions produce 401, verified users without approved access produce 403, and backend or configuration failures produce 503. `/api/auth/config` remains the only auth endpoint surface and exposes only the pinned project URL and public key. There is no registration UI; Supabase public signup must be disabled and access explicitly provisioned.

No second session cookie or password authority is maintained. Provider errors never include raw tokens, headers or database responses, and database failures produce a clear unavailable state rather than simulated data. With no browser sign-in, private endpoints show an honest unavailable state until a valid session is present; Cloudflare Access is the gate that keeps anonymous internet users off every endpoint.

## Persistence boundary

The Supabase adapter preserves domain repositories while routing their supported operations through the Data API and narrowly scoped RPCs. There is no arbitrary SQL-over-HTTP endpoint. Runtime uses a public key and the user's JWT, not a database password or service-role key. RLS ownership maps an approved Supabase Auth UUID to the existing local application user identity, preserving domain foreign keys during a reviewed data migration.

The existing domain schema includes application users, account settings, audit logs, analysis snapshots, proposals/decisions, risk records, historical simulation, paper records, execution reconciliation and operations supervision. Historical custom-password/session tables are retained only as source migration history; the running application does not authenticate against them. Do not erase or automatically import their credential/session records.

Before applying the Supabase migration, inspect the actual target schema, policies, data, grants and role definitions. The new migration and verification SQL are review artifacts and are never run at application startup. An existing schema is not assumed to match local migration history.

## Safety and deployment

Configuration rejects trading mode changes, live execution, background worker enablement, MT5 demo/connector use and MT5 execution. Pure simulation and adapter tests use isolated mocks. No API route submits an order.

The Worker uses Static Assets from `src/`; `src/.assetsignore` excludes the server entry point. `src/_headers` supplies frontend security headers, and API handlers return no-store JSON. The CSP connects only to the same origin and the intended Supabase project. Browser authorization uses bearer headers rather than authentication cookies; state-changing application APIs additionally enforce origin and authenticated request checks.

`wrangler.jsonc` pins the existing Worker name and compatibility date and commits public disabled-execution defaults. Dashboard-managed variables are preserved with `keep_vars`; the final HTTPS `APP_ORIGIN` and public project key must be verified in the Worker settings. Optional provider credentials remain encrypted server secrets.

See [the release runbook](runbooks/cloudflare-deployment.md) for external prerequisites and the approval boundary. Earlier milestone reports describe historical implementations, not the current active backend.
