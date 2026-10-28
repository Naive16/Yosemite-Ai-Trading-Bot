import { fakeTokens } from "./fake-auth.mjs";
import { DatabaseQueryError } from "../../api/_lib/database.js";

export class FakeDatabase {
  constructor() { this.reset(); }
  reset() {
    this.auditEvents = []; this.rateLimitBuckets = new Map(); this.calls = []; this.failQueries = false; this.token = null;
    this.records = new Map();
    this.client = {
      rpc: (name, parameters = {}) => this.rpc(name, parameters),
      from: (table) => this.from(table)
    };
  }
  authorize(token) { this.token = token; return this; }
  async execute(operation) {
    if (this.failQueries) throw new DatabaseQueryError("Supabase database query failed");
    const result = await operation;
    if (result?.error) throw new DatabaseQueryError(undefined, result.error);
    return result?.data ?? null;
  }
  async verifySession() {
    if (this.failQueries) throw new DatabaseQueryError();
    const entry = fakeTokens.get(this.token);
    const active = Boolean(entry?.active && entry.expiresAt > Date.now());
    return { active_session: active, user_id: active && entry.authorized ? entry.userId : null, auth_user_id: entry?.user.id || null, username: active && entry.authorized ? entry.username : null };
  }
  async ping() { if (this.failQueries) throw new DatabaseQueryError(); return true; }
  expireSessions() { for (const entry of fakeTokens.values()) entry.active = false; }
  async rpc(name, parameters) {
    this.calls.push({ name, parameters });
    if (this.failQueries) return { data: null, error: new Error("synthetic database outage") };
    if (name === "yosemite_session_context") return { data: [await this.verifySession()], error: null };
    if (name === "yosemite_rate_limit") {
      const key = `${fakeTokens.get(this.token)?.user.id || "test-user"}:${parameters.p_key}`;
      const windowMs = parameters.p_window_seconds * 1000;
      let bucket = this.rateLimitBuckets.get(key);
      if (parameters.p_action === "clear") { this.rateLimitBuckets.delete(key); return { data: [{ attempt_count: 0, retry_after_seconds: 0 }], error: null }; }
      if (parameters.p_action === "consume") {
        if (!bucket || bucket.expiresAt <= Date.now()) bucket = { attemptCount: 0, expiresAt: Date.now() + windowMs };
        bucket.attemptCount += 1; this.rateLimitBuckets.set(key, bucket);
      }
      return { data: [{ attempt_count: bucket?.expiresAt > Date.now() ? bucket.attemptCount : 0, retry_after_seconds: bucket ? Math.max(0, Math.ceil((bucket.expiresAt - Date.now()) / 1000)) : parameters.p_window_seconds }], error: null };
    }
    return { data: null, error: new Error(`Unsupported fake RPC: ${name}`) };
  }
  from(table) {
    const filters = []; let operation = "select"; let payload; let maximum = Infinity;
    const db = this;
    const builder = {
      select() { return builder; },
      insert(values) { operation = "insert"; payload = values; return builder; },
      eq(field, value) { filters.push([field, value]); return builder; },
      order() { return builder; },
      limit(count) { maximum = count; return builder; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (db.failQueries) return { data: null, error: new Error("synthetic database outage") };
          db.calls.push({ table, operation, payload, filters });
          const rows = db.records.get(table) || [];
          if (operation === "insert") {
            const row = { ...payload, created_at: new Date().toISOString() };
            rows.push(row); db.records.set(table, rows);
            if (table === "audit_events") db.auditEvents.push(row);
            return { data: [row], error: null };
          }
          return { data: rows.filter((row) => filters.every(([field, value]) => row[field] === value)).slice(0, maximum), error: null };
        }).then(resolve, reject);
      }
    };
    return builder;
  }
}
