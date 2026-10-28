import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const database = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const aliceSession = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bobSession = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const outsiderSession = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const aliceId = "legacy-operator-user-0001";
const bobId = "legacy-operator-user-0002";

async function asUser(user, session, sql, values = [], role = "authenticated") {
  await database.exec("RESET ROLE");
  await database.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user, session_id: session })]);
  await database.exec(`SET ROLE ${role}`);
  try { return await database.query(sql, values); }
  finally { await database.exec("RESET ROLE"); }
}

before(async () => {
  await database.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id), not_after timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO authenticated, anon;
  `);
  const names = (await readdir(new URL("../db/migrations/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    // Simulate permissive policies/grants already present in the target project.
    if (name.startsWith("008")) await database.exec(`
      ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
      CREATE POLICY legacy_allow_all ON public.audit_events FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
      GRANT ALL ON public.audit_events TO PUBLIC;
    `);
    await database.exec(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
  }
  await database.query("INSERT INTO auth.users(id) VALUES ($1),($2),($3)", [alice,bob,outsider]);
  await database.query("INSERT INTO auth.sessions(id,user_id) VALUES ($1,$2),($3,$4),($5,$6)", [aliceSession,alice,bobSession,bob,outsiderSession,outsider]);
  await database.query("INSERT INTO public.app_users(id,username,password_hash) VALUES ($1,'operator_a','SUPABASE_AUTH_MANAGED_NO_LOCAL_PASSWORD'),($2,'operator_b','SUPABASE_AUTH_MANAGED_NO_LOCAL_PASSWORD')", [aliceId,bobId]);
  await database.query("INSERT INTO public.yosemite_members(auth_user_id,app_user_id,enabled) VALUES ($1,$2,true),($3,$4,true)", [alice,aliceId,bob,bobId]);
  await database.query("INSERT INTO public.audit_events(id,user_id,event_type) VALUES ('audit-alice-000000000001',$1,'fixture.created'),('audit-bob-0000000000001',$2,'fixture.created')", [aliceId,bobId]);
  await database.query("INSERT INTO public.risk_configurations(version,configuration,active) VALUES ('test-v1','{}',true)");
  await database.query("INSERT INTO public.risk_evaluations(id,user_id,decision,inputs,configuration_version) VALUES ('risk-alice-000000000001',$1,'BLOCKED','{}','test-v1'),('risk-bob-0000000000001',$2,'BLOCKED','{}','test-v1')", [aliceId,bobId]);
  await database.query("INSERT INTO public.backtest_runs(id,user_id,status,configuration) VALUES ('backtest-alice-1',$1,'queued','{}'),('backtest-bob-1',$2,'queued','{}')", [aliceId,bobId]);
  await database.query("INSERT INTO public.paper_events(event_id,user_id,status,payload) VALUES ('paper-alice-1',$1,'blocked','{}'),('paper-bob-1',$2,'blocked','{}')", [aliceId,bobId]);
  const payload = { immutableContent: { risk: { decision: "PASS" }, direction: "BUY", stopLoss: { value: 1.09 }, takeProfit: { value: 1.12 } } };
  await database.query("INSERT INTO public.trade_proposals(id,user_id,version,status,content_digest,payload,expires_at) VALUES ('proposal-alice',$1,1,'pending_approval',$3,$4::jsonb,CURRENT_TIMESTAMP+INTERVAL '1 hour'),('proposal-bob',$2,1,'pending_approval',$3,$4::jsonb,CURRENT_TIMESTAMP+INTERVAL '1 hour')", [aliceId,bobId,"a".repeat(64),JSON.stringify(payload)]);
});
after(async () => { await database.close(); });

test("all application tables have RLS and legacy passwords/session tables have no Data API grants", async () => {
  const tables = await database.query("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'");
  assert.ok(tables.rows.length >= 22);
  assert.ok(tables.rows.every((table) => table.rowsecurity));
  for (const table of ["app_users","auth_sessions","yosemite_members","worker_leases","recovery_tasks","rate_limit_buckets"]) {
    await assert.rejects(() => asUser(alice,aliceSession,`SELECT * FROM public.${table}`), /permission denied/);
  }
});
test("approved members restore the preserved legacy user ID; unapproved members have no domain identity", async () => {
  const own = await asUser(alice,aliceSession,"SELECT * FROM public.yosemite_session_context()");
  assert.deepEqual(own.rows[0], { active_session: true, user_id: aliceId, auth_user_id: alice, username: "operator_a" });
  const unknown = await asUser(outsider,outsiderSession,"SELECT * FROM public.yosemite_session_context()");
  assert.equal(unknown.rows[0].active_session,true); assert.equal(unknown.rows[0].user_id,null);
});
test("RLS isolates real SELECT queries across private domain tables", async () => {
  for (const table of ["audit_events","risk_evaluations","backtest_runs","paper_events","trade_proposals"]) {
    const own = await asUser(alice,aliceSession,`SELECT user_id FROM public.${table}`);
    assert.equal(own.rows.length,1,table); assert.equal(own.rows[0].user_id,aliceId,table);
    const other = await asUser(alice,aliceSession,`SELECT * FROM public.${table} WHERE user_id=$1`,[bobId]);
    assert.equal(other.rows.length,0,table);
  }
});
test("existing permissive policies and PUBLIC grants cannot bypass cross-user INSERT checks", async () => {
  await assert.rejects(() => asUser(alice,aliceSession,"INSERT INTO public.audit_events(id,user_id,event_type) VALUES ($1,$2,'forged.event')",["audit-forged-000000000001",bobId]), /row-level security/);
  await asUser(alice,aliceSession,"INSERT INTO public.audit_events(id,user_id,event_type) VALUES ($1,$2,'own.event')",["audit-valid-0000000000001",aliceId]);
  await assert.rejects(() => asUser(alice,aliceSession,"UPDATE public.trade_proposals SET status='approved' WHERE user_id=$1",[aliceId]), /permission denied/);
  await assert.rejects(() => asUser(alice,aliceSession,"INSERT INTO public.yosemite_members(auth_user_id,app_user_id,enabled) VALUES ($1,$2,true)",[outsider,bobId]), /permission denied/);
});
test("proposal RPC enforces owner, digest, pending state and atomic decision insertion", async () => {
  const other = await asUser(alice,aliceSession,"SELECT * FROM public.yosemite_transition_proposal($1,1,$2,'approved',NULL)",["proposal-bob","a".repeat(64)]);
  assert.equal(other.rows.length,0);
  const wrong = await asUser(alice,aliceSession,"SELECT * FROM public.yosemite_transition_proposal($1,1,$2,'approved',NULL)",["proposal-alice","b".repeat(64)]);
  assert.equal(wrong.rows.length,0);
  const own = await asUser(alice,aliceSession,"SELECT * FROM public.yosemite_transition_proposal($1,1,$2,'approved',NULL)",["proposal-alice","a".repeat(64)]);
  assert.deepEqual(own.rows[0],{ proposal_id:"proposal-alice",proposal_version:1,decision:"approved" });
  const repeated = await asUser(alice,aliceSession,"SELECT * FROM public.yosemite_transition_proposal($1,1,$2,'approved',NULL)",["proposal-alice","a".repeat(64)]);
  assert.equal(repeated.rows.length,0);
  const decisions = await database.query("SELECT * FROM public.trade_proposal_decisions"); assert.equal(decisions.rows.length,1);
});
test("rate-limit RPC increments atomically, scopes buckets per verified user, and denies unapproved users", async () => {
  const key = "c".repeat(64);
  const first = await asUser(alice,aliceSession,"SELECT * FROM public.yosemite_rate_limit($1,60,'consume')",[key]);
  const second = await asUser(alice,aliceSession,"SELECT * FROM public.yosemite_rate_limit($1,60,'consume')",[key]);
  const separate = await asUser(bob,bobSession,"SELECT * FROM public.yosemite_rate_limit($1,60,'consume')",[key]);
  assert.equal(first.rows[0].attempt_count,1); assert.equal(second.rows[0].attempt_count,2); assert.equal(separate.rows[0].attempt_count,1);
  await assert.rejects(() => asUser(outsider,outsiderSession,"SELECT * FROM public.yosemite_rate_limit($1,60,'consume')",[key]), /Approved membership/);
});
test("missing, revoked and expired Supabase sessions immediately lose all protected rows", async () => {
  const revoked = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const context = await asUser(alice,revoked,"SELECT * FROM public.yosemite_session_context()");
  assert.equal(context.rows[0].active_session,false); assert.equal(context.rows[0].user_id,null);
  assert.equal((await asUser(alice,revoked,"SELECT * FROM public.trade_proposals")).rows.length,0);
  await database.query("UPDATE auth.sessions SET not_after=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=$1",[bobSession]);
  assert.equal((await asUser(bob,bobSession,"SELECT * FROM public.yosemite_session_context()")).rows[0].active_session,false);
  await database.query("DELETE FROM auth.sessions WHERE id=$1",[aliceSession]);
  assert.equal((await asUser(alice,aliceSession,"SELECT * FROM public.audit_events")).rows.length,0);
  await assert.rejects(() => asUser(alice,aliceSession,"SELECT * FROM public.yosemite_rate_limit($1,60,'consume')",["e".repeat(64)]), /Approved membership/);
});
test("anonymous roles cannot invoke session, identity or mutation RPCs", async () => {
  await assert.rejects(() => asUser(alice,aliceSession,"SELECT * FROM public.yosemite_session_context()",[],"anon"), /permission denied/);
  await assert.rejects(() => asUser(alice,aliceSession,"SELECT * FROM public.audit_events",[],"anon"), /permission denied/);
});
