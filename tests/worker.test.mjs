import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigurationError } from "../api/_lib/config.js";
import { WorkerLifecycle, WorkerConfigurationError } from "../api/_lib/worker/lifecycle.js";

const baseEnv = { APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", SUPABASE_URL: "https://txdjozotaxpthpnfikqx.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only" };

test("worker configuration is disabled and rejects enablement during authentication repair", () => {
  assert.equal(loadConfig(baseEnv).worker.enabled, false);
  assert.throws(() => loadConfig({ ...baseEnv, WORKER_ENABLED: "yes" }), ConfigurationError);
  assert.throws(() => loadConfig({ ...baseEnv, SUPABASE_PUBLISHABLE_KEY: "", WORKER_ENABLED: "true" }), ConfigurationError);
  assert.throws(() => loadConfig({ ...baseEnv, WORKER_ENABLED: "true", WORKER_ID: "worker-a" }), ConfigurationError);
  const configured = loadConfig({ ...baseEnv, WORKER_ID: "worker-a", WORKER_HEARTBEAT_INTERVAL_SECONDS: "20" });
  assert.equal(configured.worker.enabled, false);
  assert.equal(configured.worker.id, "worker-a");
});

test("worker lifecycle supports graceful shutdown, duplicate jobs, and stale heartbeat detection", () => {
  let now = new Date("2026-10-22T00:00:00.000Z");
  const lifecycle = new WorkerLifecycle({ workerId: "worker-a", heartbeatIntervalSeconds: 15, now: () => now });
  assert.equal(lifecycle.snapshot().healthy, false);
  lifecycle.start();
  assert.equal(lifecycle.snapshot().healthy, true);
  assert.deepEqual(lifecycle.acceptJob("job-1"), { status: "accepted", jobId: "job-1", executionAllowed: false, reason: "worker_execution_disabled" });
  assert.deepEqual(lifecycle.acceptJob("job-1"), { status: "duplicate", jobId: "job-1" });
  now = new Date("2026-10-22T00:00:31.000Z");
  assert.equal(lifecycle.snapshot().healthy, false);
  lifecycle.heartbeat();
  assert.equal(lifecycle.snapshot().healthy, true);
  lifecycle.stop("test shutdown");
  assert.equal(lifecycle.snapshot().state, "stopped");
  assert.equal(lifecycle.snapshot().executionAllowed, false);
  assert.throws(() => lifecycle.acceptJob("job-2"), WorkerConfigurationError);
});
