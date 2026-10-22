export const ALERT_TYPES = Object.freeze({
  DATABASE_UNAVAILABLE: "database.unavailable", MARKET_STALE: "market_data.stale", WORKER_STALE: "worker.stale",
  AUTH_THROTTLED: "auth.throttled", RECONCILIATION_BACKLOG: "reconciliation.backlog", UNKNOWN_BROKER_OUTCOME: "broker.unknown_outcome",
  DISCREPANCY: "reconciliation.discrepancy", RISK_BLOCKED: "risk.blocked", EMERGENCY_STOP: "execution.emergency_stop", UNSAFE_CONFIG: "configuration.unsafe"
});

export class AlertManager {
  constructor({ now = () => Date.now(), cooldownMs = 300_000, deliver = null, maxRetries = 0 } = {}) {
    this.now = now; this.cooldownMs = cooldownMs; this.deliver = deliver; this.maxRetries = maxRetries; this.entries = new Map();
  }
  emit({ type, severity = "warning", message, correlationId = null, metadata = {} }) {
    const now = this.now(); const prior = this.entries.get(type);
    if (prior && prior.nextAllowedAt > now) return { ...prior.last, deduplicated: true };
    const event = { type, severity, message: String(message || "Operational alert"), correlationId, metadata, loggedAt: new Date(now).toISOString(), deliveryStatus: this.deliver ? "pending" : "unavailable", deduplicated: false };
    let deliveryStatus = event.deliveryStatus;
    if (this.deliver) { try { this.deliver(event, this.maxRetries); deliveryStatus = "delivered"; } catch { deliveryStatus = "failed"; } }
    const last = { ...event, deliveryStatus };
    this.entries.set(type, { last, nextAllowedAt: now + this.cooldownMs });
    return last;
  }
  snapshot() { return [...this.entries.values()].map(({ last }) => last); }
}
