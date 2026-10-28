-- READ ONLY. Run this in Supabase SQL Editor and save the results for review.
-- Confirm the project reference is txdjozotaxpthpnfikqx before running anything.
SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_schema IN ('public','auth') ORDER BY table_schema, table_name, ordinal_position;
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;
SELECT table_schema, table_name, grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' ORDER BY table_name, grantee;
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conrelid::regclass::text, conname;
SELECT n.nspname, p.proname, p.prosecdef, p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY p.proname;
SELECT schemaname, tablename, tableowner, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
SELECT n.nspname, c.relname, c.relkind, c.reloptions, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('v','m') ORDER BY c.relname;
SELECT event_object_table, trigger_name, action_timing, event_manipulation FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY event_object_table, trigger_name;
SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl FROM pg_default_acl;
-- Do not assume schema_migrations exists. Inspect its table definition first,
-- then SELECT version, applied_at FROM public.schema_migrations ORDER BY version;
