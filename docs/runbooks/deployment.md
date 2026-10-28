# Current deployment guidance

The active authentication/backend implementation is Supabase Auth plus the Supabase Data API on the existing Cloudflare Worker. The earlier custom-password and Neon deployment instructions are retired.

Use [the current Supabase and Cloudflare release runbook](cloudflare-deployment.md) for configuration, reviewed migration steps, local verification, manual GitHub upload exclusions and the production approval boundary.

The optional Node server remains available through `npm start`; its startup helper reads ignored `.env` when present, and platform environment values take precedence. Do not configure Neon/Hyperdrive or custom session secrets for this version. Trading, worker execution and broker connections must remain disabled.
