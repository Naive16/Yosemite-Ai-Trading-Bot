// Production migrations require an explicit schema/data review and approval.
// This command deliberately opens no database connection and applies nothing.
console.error("Automatic migrations are disabled. Run the read-only db/supabase-preflight.sql in the intended Supabase project, compare the actual schema/data with db/migrations, obtain approval, then apply only the reviewed missing SQL in a transaction. See docs/runbooks/supabase-migration.md.");
process.exitCode = 1;
