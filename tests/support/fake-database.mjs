export class FakeDatabase {
  constructor() {
    this.reset();
  }

  reset() {
    this.users = new Map();
    this.sessions = new Map();
    this.auditEvents = [];
    this.rateLimitBuckets = new Map();
    this.calls = [];
    this.failQueries = false;
  }

  async query(text, values = []) {
    this.calls.push({ text, values });
    if (this.failQueries) throw new Error("simulated database outage");

    if (text.includes("SELECT attempt_count") && text.includes("rate_limit_buckets")) {
      const bucket = this.rateLimitBuckets.get(values[0]);
      if (!bucket || bucket.expiresAt <= Date.now()) return { rows: [] };
      return { rows: [{ attempt_count: bucket.attemptCount, retry_after_seconds: Math.ceil((bucket.expiresAt - Date.now()) / 1_000) }] };
    }

    if (text.includes("INSERT INTO rate_limit_buckets")) {
      const key = values[0];
      const windowMs = Number(values[1]) * 1_000;
      const current = this.rateLimitBuckets.get(key);
      const expired = !current || current.expiresAt <= Date.now();
      const bucket = expired
        ? { attemptCount: 1, expiresAt: Date.now() + windowMs }
        : { attemptCount: current.attemptCount + 1, expiresAt: current.expiresAt };
      this.rateLimitBuckets.set(key, bucket);
      if (text.includes("RETURNING attempt_count")) return { rows: [{ attempt_count: bucket.attemptCount, retry_after_seconds: Math.ceil((bucket.expiresAt - Date.now()) / 1_000) }] };
      return { rows: [] };
    }

    if (text.includes("DELETE FROM rate_limit_buckets") && text.includes("expires_at <")) {
      for (const [key, bucket] of this.rateLimitBuckets) if (bucket.expiresAt < Date.now() - 86_400_000) this.rateLimitBuckets.delete(key);
      return { rows: [] };
    }

    if (text.includes("DELETE FROM rate_limit_buckets")) {
      this.rateLimitBuckets.delete(values[0]);
      return { rows: [] };
    }

    if (text.includes("SELECT id, username") && text.includes("FROM app_users") && text.includes("WHERE id = $1")) {
      await Promise.resolve();
      const [id] = values;
      const existing = [...this.users.values()].find((candidate) => candidate.id === id);
      return { rows: existing ? [{ id: existing.id, username: existing.username }] : [] };
    }

    if (text.includes("INSERT INTO app_users")) {
      const [id, username, passwordHash] = values;
      if (text.includes("ON CONFLICT DO NOTHING")) {
        const existingById = [...this.users.values()].find((candidate) => candidate.id === id);
        const existingByUsername = this.users.get(username);
        if (existingById || existingByUsername) return { rows: [] };
        const row = { id, username, password_hash: passwordHash };
        this.users.set(username, row);
        return { rows: [{ id: row.id, username: row.username }] };
      }
      const existing = this.users.get(username);
      const row = { id: existing?.id || id, username, password_hash: passwordHash };
      this.users.set(username, row);
      return { rows: [row] };
    }

    if (text.includes("WITH inserted_session")) {
      const [tokenHash, userId, csrfTokenHash, expiresAt, auditId, metadata] = values;
      this.sessions.set(tokenHash, { token_hash: tokenHash, user_id: userId, csrf_token_hash: csrfTokenHash, created_at: new Date(), expires_at: new Date(expiresAt), revoked_at: null });
      this.auditEvents.push({ id: auditId, user_id: userId, event_type: "auth.login.succeeded", metadata: JSON.parse(metadata), created_at: new Date() });
      return { rows: [{ id: auditId }] };
    }

    if (text.includes("SELECT s.user_id")) {
      const [tokenHash] = values;
      const session = this.sessions.get(tokenHash);
      if (!session || session.revoked_at || session.expires_at <= new Date()) return { rows: [] };
      const user = [...this.users.values()].find((candidate) => candidate.id === session.user_id);
      return { rows: [{ ...session, username: user?.username }] };
    }

    if (text.includes("WITH revoked_session")) {
      const [tokenHash, auditId, metadata] = values;
      const session = this.sessions.get(tokenHash);
      if (!session || session.revoked_at) return { rows: [] };
      session.revoked_at = new Date();
      this.auditEvents.push({ id: auditId, user_id: session.user_id, event_type: "auth.logout", metadata: JSON.parse(metadata), created_at: new Date() });
      return { rows: [{ id: auditId }] };
    }

    if (text.includes("INSERT INTO audit_events")) {
      const [id, userId, eventType, metadata] = values;
      this.auditEvents.push({ id, user_id: userId, event_type: eventType, metadata: JSON.parse(metadata), created_at: new Date() });
      return { rows: [] };
    }

    if (text.includes("SELECT 1 AS ok")) return { rows: [{ ok: 1 }] };
    throw new Error(`Unsupported fake query: ${text.slice(0, 80)}`);
  }

  expireSessions() {
    for (const session of this.sessions.values()) session.expires_at = new Date(Date.now() - 1_000);
  }
}
