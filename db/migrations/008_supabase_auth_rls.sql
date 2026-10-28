-- REVIEW BEFORE APPLYING. This changes Data API grants/RLS and must be approved.
-- Apply only after comparing the target schema and backing up existing data.
-- No historical IDs, passwords, sessions, domain rows, or policies are removed.
BEGIN;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL OR to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'This migration requires the existing Supabase Auth schema';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('app_users','trade_proposals','audit_events','risk_evaluations') AND column_name IN ('id','user_id') AND data_type <> 'text') THEN
    RAISE EXCEPTION 'Unexpected application identity column types; review target schema before migration';
  END IF;
END $$;

-- A preexisting name must be reconciled explicitly, never silently reused.
CREATE TABLE public.yosemite_members (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  app_user_id text NOT NULL UNIQUE REFERENCES public.app_users(id),
  enabled boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'operator' CHECK (role = 'operator'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION public.yosemite_has_active_session() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.user_id = auth.uid()
      AND s.id::text = (auth.jwt() ->> 'session_id')
      AND (s.not_after IS NULL OR s.not_after > CURRENT_TIMESTAMP)
  )
$$;
CREATE FUNCTION public.yosemite_current_user_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.app_user_id FROM public.yosemite_members m
  WHERE m.auth_user_id = auth.uid() AND m.enabled AND public.yosemite_has_active_session()
$$;
CREATE FUNCTION public.yosemite_session_context()
RETURNS TABLE (active_session boolean, user_id text, auth_user_id uuid, username text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.yosemite_has_active_session(), m.app_user_id, auth.uid(), u.username
  FROM (VALUES (1)) singleton(n)
  LEFT JOIN public.yosemite_members m ON m.auth_user_id = auth.uid() AND m.enabled AND public.yosemite_has_active_session()
  LEFT JOIN public.app_users u ON u.id = m.app_user_id
$$;

-- Restrictive policies continue to enforce ownership even if a target already
-- contains an older permissive policy. All grants below concern named app tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schema_migrations','app_users','auth_sessions','yosemite_members','audit_events','risk_configurations','risk_daily_state','risk_account_snapshots','risk_position_snapshots','risk_evaluations','trade_proposals','trade_proposal_decisions','backtest_runs','paper_events','paper_positions','paper_trades','execution_intents','execution_transitions','operational_alerts','worker_leases','recovery_tasks','rate_limit_buckets'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['schema_migrations','app_users','auth_sessions','yosemite_members','risk_daily_state','risk_account_snapshots','risk_position_snapshots','operational_alerts','worker_leases','recovery_tasks','rate_limit_buckets'] LOOP
    EXECUTE format('CREATE POLICY yosemite_deny_direct ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false)', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['audit_events','risk_evaluations','trade_proposals','backtest_runs','paper_events','paper_positions','paper_trades','execution_intents'] LOOP
    EXECUTE format('CREATE POLICY yosemite_owner_guard ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (user_id = (SELECT public.yosemite_current_user_id())) WITH CHECK (user_id = (SELECT public.yosemite_current_user_id()))', t);
    EXECUTE format('CREATE POLICY yosemite_owner_read ON public.%I FOR SELECT TO authenticated USING (user_id = (SELECT public.yosemite_current_user_id()))', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END $$;

GRANT INSERT ON TABLE public.audit_events, public.risk_evaluations TO authenticated;
CREATE POLICY yosemite_owner_insert ON public.audit_events FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT public.yosemite_current_user_id()));
CREATE POLICY yosemite_owner_insert ON public.risk_evaluations FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT public.yosemite_current_user_id()));
GRANT SELECT ON TABLE public.risk_configurations, public.trade_proposal_decisions, public.execution_transitions TO authenticated;
CREATE POLICY yosemite_member_guard ON public.risk_configurations AS RESTRICTIVE FOR ALL TO PUBLIC USING ((SELECT public.yosemite_current_user_id()) IS NOT NULL) WITH CHECK (false);
CREATE POLICY yosemite_member_read ON public.risk_configurations FOR SELECT TO authenticated USING ((SELECT public.yosemite_current_user_id()) IS NOT NULL);
CREATE POLICY yosemite_decision_guard ON public.trade_proposal_decisions AS RESTRICTIVE FOR ALL TO PUBLIC USING (actor_user_id = (SELECT public.yosemite_current_user_id()) AND EXISTS (SELECT 1 FROM public.trade_proposals p WHERE p.id = proposal_id AND p.version = proposal_version AND p.user_id = (SELECT public.yosemite_current_user_id()))) WITH CHECK (false);
CREATE POLICY yosemite_decision_read ON public.trade_proposal_decisions FOR SELECT TO authenticated USING (actor_user_id = (SELECT public.yosemite_current_user_id()));
CREATE POLICY yosemite_transition_guard ON public.execution_transitions AS RESTRICTIVE FOR ALL TO PUBLIC USING (EXISTS (SELECT 1 FROM public.execution_intents e WHERE e.id = execution_id AND e.user_id = (SELECT public.yosemite_current_user_id()))) WITH CHECK (false);
CREATE POLICY yosemite_transition_read ON public.execution_transitions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.execution_intents e WHERE e.id = execution_id AND e.user_id = (SELECT public.yosemite_current_user_id())));

CREATE FUNCTION public.yosemite_transition_proposal(p_proposal_id text, p_version integer, p_content_digest text, p_next_status text, p_reason text DEFAULT NULL)
RETURNS TABLE (proposal_id text, proposal_version integer, decision text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner_id text := public.yosemite_current_user_id();
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION 'Approved membership and active session required' USING ERRCODE = '42501'; END IF;
  IF p_next_status IS NULL OR p_next_status NOT IN ('approved','rejected') OR char_length(coalesce(p_reason,'')) > 500 THEN RAISE EXCEPTION 'Invalid proposal decision' USING ERRCODE = '22023'; END IF;
  RETURN QUERY WITH changed AS (
    UPDATE public.trade_proposals p SET status = p_next_status, updated_at = CURRENT_TIMESTAMP
    WHERE p.user_id = owner_id AND p.id = p_proposal_id AND p.version = p_version
      AND p.content_digest = p_content_digest AND p.status = 'pending_approval' AND p.expires_at > CURRENT_TIMESTAMP
      AND (p_next_status <> 'approved' OR (p.payload #>> '{immutableContent,risk,decision}' = 'PASS' AND p.payload #>> '{immutableContent,direction}' IN ('BUY','SELL') AND p.payload #>> '{immutableContent,stopLoss,value}' IS NOT NULL AND p.payload #>> '{immutableContent,takeProfit,value}' IS NOT NULL))
    RETURNING p.id, p.version, p.content_digest
  ) INSERT INTO public.trade_proposal_decisions (id, proposal_id, proposal_version, actor_user_id, decision, reason, content_digest)
    SELECT gen_random_uuid()::text, c.id, c.version, owner_id, p_next_status, p_reason, c.content_digest FROM changed c
    RETURNING trade_proposal_decisions.proposal_id, trade_proposal_decisions.proposal_version, trade_proposal_decisions.decision;
END $$;

CREATE FUNCTION public.yosemite_rate_limit(p_key text, p_window_seconds integer, p_action text)
RETURNS TABLE (attempt_count integer, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE scoped_key text := auth.uid()::text || ':' || p_key;
BEGIN
  IF public.yosemite_current_user_id() IS NULL THEN RAISE EXCEPTION 'Approved membership and active session required' USING ERRCODE = '42501'; END IF;
  IF p_key IS NULL OR p_window_seconds IS NULL OR p_action IS NULL OR p_key !~ '^[a-f0-9]{64}$' OR p_window_seconds NOT BETWEEN 1 AND 86400 OR p_action NOT IN ('check','consume','clear') THEN RAISE EXCEPTION 'Invalid limiter parameters' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.rate_limit_buckets b WHERE b.bucket_key LIKE auth.uid()::text || ':%' AND b.expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day';
  IF p_action = 'clear' THEN
    DELETE FROM public.rate_limit_buckets b WHERE b.bucket_key = scoped_key;
    RETURN QUERY SELECT 0, 0;
  ELSIF p_action = 'check' THEN
    RETURN QUERY SELECT b.attempt_count, ceil(GREATEST(EXTRACT(EPOCH FROM (b.expires_at - CURRENT_TIMESTAMP)),0))::integer FROM public.rate_limit_buckets b WHERE b.bucket_key = scoped_key AND b.expires_at > CURRENT_TIMESTAMP;
    IF NOT FOUND THEN RETURN QUERY SELECT 0, p_window_seconds; END IF;
  ELSE
    RETURN QUERY INSERT INTO public.rate_limit_buckets AS b (bucket_key, window_started_at, attempt_count, expires_at, updated_at)
      VALUES (scoped_key, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP + (p_window_seconds * INTERVAL '1 second'), CURRENT_TIMESTAMP)
      ON CONFLICT (bucket_key) DO UPDATE SET
        window_started_at = CASE WHEN b.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE b.window_started_at END,
        attempt_count = CASE WHEN b.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE b.attempt_count + 1 END,
        expires_at = CASE WHEN b.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + (p_window_seconds * INTERVAL '1 second') ELSE b.expires_at END,
        updated_at = CURRENT_TIMESTAMP
      RETURNING b.attempt_count, ceil(GREATEST(EXTRACT(EPOCH FROM (b.expires_at - CURRENT_TIMESTAMP)),0))::integer;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.yosemite_has_active_session(), public.yosemite_current_user_id(), public.yosemite_session_context(), public.yosemite_transition_proposal(text,integer,text,text,text), public.yosemite_rate_limit(text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.yosemite_has_active_session(), public.yosemite_current_user_id(), public.yosemite_session_context(), public.yosemite_transition_proposal(text,integer,text,text,text), public.yosemite_rate_limit(text,integer,text) TO authenticated;
INSERT INTO public.schema_migrations (version) VALUES ('000008');
COMMIT;

