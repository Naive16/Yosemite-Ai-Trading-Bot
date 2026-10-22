import test from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../api/_lib/operations/logger.js";
import { AlertManager, ALERT_TYPES } from "../api/_lib/operations/alerts.js";
import { boundedBackoff, shouldRetry } from "../api/_lib/operations/retry.js";
import { recoveryDecision } from "../api/_lib/operations/recovery.js";
import { buildHealthReport, heartbeatHealth } from "../api/_lib/operations/health.js";
import { readFile } from "node:fs/promises";

test("structured logs are bounded and redact security material", () => {
  const entries = [];
  const logger = createLogger({ sink: (entry) => entries.push(entry), correlationFactory: () => "corr-1", now: () => new Date("2026-01-01T00:00:00Z") });
  const entry = logger.write({ component: "auth", eventType: "login", metadata: { password: "secret", authorization: "Bearer token", note: "x".repeat(500) } });
  assert.equal(entries.length, 1);
  assert.equal(entry.metadata.password, "[redacted]");
  assert.equal(entry.metadata.authorization, "[redacted]");
  assert.ok(entry.metadata.note.length <= 257);
  assert.equal(entry.correlationId, "corr-1");
});

test("alerts distinguish logged, deduplicated, and undelivered events", () => {
  let now = 0; const manager = new AlertManager({ now: () => now, cooldownMs: 100 });
  const first = manager.emit({ type: ALERT_TYPES.DATABASE_UNAVAILABLE, message: "database unavailable" });
  const duplicate = manager.emit({ type: ALERT_TYPES.DATABASE_UNAVAILABLE, message: "database unavailable" });
  assert.equal(first.deliveryStatus, "unavailable");
  assert.equal(duplicate.deduplicated, true);
  now = 101;
  assert.equal(manager.emit({ type: ALERT_TYPES.DATABASE_UNAVAILABLE, message: "database unavailable" }).deduplicated, false);
});

test("retries are bounded and never retry unknown broker submissions", () => {
  assert.equal(shouldRetry({ operation: "broker_submission", attempt: 0, errorKind: "timeout" }), false);
  assert.equal(shouldRetry({ operation: "read_only_probe", attempt: 0, errorKind: "timeout", maxAttempts: 2 }), true);
  assert.ok(boundedBackoff(10, { baseMs: 10, maxMs: 100, jitter: 0, random: () => 0 }) <= 100);
  assert.deepEqual(recoveryDecision({ taskType: "broker_submission", state: "submission_unknown" }).action, "reconcile");
  assert.equal(recoveryDecision({ taskType: "audit_read", state: "queued", attempt: 0 }).retry, true);
});

test("health model does not infer readiness or enable execution", () => {
  const report = buildHealthReport({ components: { process: { state: "operational" }, database: { state: "unknown" }, risk: { state: "blocked" } } });
  assert.equal(report.tradingEnabled, false);
  assert.equal(report.services.execution.state, "blocked");
  assert.equal(report.services.database.state, "unknown");
  assert.equal(heartbeatHealth({ enabled: true, now: Date.parse("2026-01-01T00:00:00Z"), lastHeartbeatAt: "2025-12-31T23:50:00Z", intervalSeconds: 30 }).state, "stale");
});

test("operations migration is additive and creates durable supervision tables", async () => {
  const sql = await readFile(new URL("../db/migrations/006_operations.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS operational_alerts/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS worker_leases/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS recovery_tasks/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/i);
  assert.match(sql, /timestamptz/);
});
