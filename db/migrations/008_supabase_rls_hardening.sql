-- Yosemite AI Milestone 15 Supabase PostgreSQL Row Level Security (RLS) and PostgREST hardening.
-- Additive and non-destructive: enables RLS across all 21 public tables, revokes PostgREST client
-- role privileges so application tables are never exposed to browser/anon traffic, and installs
-- defense-in-depth restrictive and owner-scoped policies.

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_daily_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_account_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_position_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_proposal_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  schema_migrations,
  app_users,
  auth_sessions,
  audit_events,
  risk_configurations,
  risk_daily_state,
  risk_account_snapshots,
  risk_position_snapshots,
  risk_evaluations,
  trade_proposals,
  trade_proposal_decisions,
  backtest_runs,
  paper_events,
  paper_positions,
  paper_trades,
  execution_intents,
  execution_transitions,
  operational_alerts,
  worker_leases,
  recovery_tasks,
  rate_limit_buckets
FROM PUBLIC;

DO $rls$
DECLARE
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_authenticated boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  internal_table text;
  internal_tables text[] := ARRAY[
    'schema_migrations',
    'auth_sessions',
    'risk_configurations',
    'risk_daily_state',
    'risk_account_snapshots',
    'risk_position_snapshots',
    'execution_transitions',
    'operational_alerts',
    'worker_leases',
    'recovery_tasks',
    'rate_limit_buckets'
  ];
  user_table text;
  user_column text;
  user_scoped_tables text[][] := ARRAY[
    ARRAY['app_users', 'id'],
    ARRAY['audit_events', 'user_id'],
    ARRAY['risk_evaluations', 'user_id'],
    ARRAY['trade_proposals', 'user_id'],
    ARRAY['trade_proposal_decisions', 'actor_user_id'],
    ARRAY['backtest_runs', 'user_id'],
    ARRAY['paper_events', 'user_id'],
    ARRAY['paper_positions', 'user_id'],
    ARRAY['paper_trades', 'user_id'],
    ARRAY['execution_intents', 'user_id']
  ];
  jwt_sub_sql text := '(SELECT COALESCE(NULLIF(current_setting(''request.jwt.claim.sub'', true), ''''), (NULLIF(current_setting(''request.jwt.claims'', true), '''')::jsonb ->> ''sub'')))';
BEGIN
  IF has_anon THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
  END IF;

  IF has_authenticated THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
  END IF;

  -- Server-only internal tables: deny anon and authenticated roles unconditionally via restrictive policies.
  FOREACH internal_table IN ARRAY internal_tables LOOP
    IF has_anon AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = internal_table AND policyname = internal_table || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false)',
        internal_table || '_deny_anon',
        internal_table
      );
    END IF;

    IF has_authenticated AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = internal_table AND policyname = internal_table || '_deny_authenticated'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (false) WITH CHECK (false)',
        internal_table || '_deny_authenticated',
        internal_table
      );
    END IF;
  END LOOP;

  -- User-linked domain tables: deny anon unconditionally; scope any authenticated SELECT strictly to matching JWT sub UUID;
  -- allow zero client writes (all mutations must pass through Yosemite server-side handlers, CSRF, and owner guards).
  FOR i IN 1 .. array_length(user_scoped_tables, 1) LOOP
    user_table := user_scoped_tables[i][1];
    user_column := user_scoped_tables[i][2];

    IF has_anon AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = user_table AND policyname = user_table || '_deny_anon'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false)',
        user_table || '_deny_anon',
        user_table
      );
    END IF;

    IF has_authenticated AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = user_table AND policyname = user_table || '_owner_select'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%I IS NOT NULL AND %I = %s)',
        user_table || '_owner_select',
        user_table,
        user_column,
        user_column,
        jwt_sub_sql
      );
    END IF;
  END LOOP;
END
$rls$;
