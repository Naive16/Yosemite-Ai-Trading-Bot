export const HEALTH_STATES = Object.freeze(["operational", "healthy", "degraded", "stale", "unavailable", "unknown", "blocked"]);

function normalize(name, value = {}) {
  const state = HEALTH_STATES.includes(value.state) ? value.state : "unknown";
  return { name, state, checkedAt: value.checkedAt || null, reason: value.reason || null, source: value.source || "server" };
}

export function heartbeatHealth({ enabled = false, lastHeartbeatAt = null, now = Date.now(), intervalSeconds = 30 } = {}) {
  if (!enabled) return normalize("worker", { state: "unknown", reason: "Worker is disabled" });
  if (!lastHeartbeatAt) return normalize("worker", { state: "stale", reason: "No durable heartbeat observed" });
  const age = Math.max(0, now - new Date(lastHeartbeatAt).getTime()) / 1000;
  return normalize("worker", { state: age <= intervalSeconds * 2 ? "healthy" : "stale", checkedAt: new Date(now).toISOString(), reason: `${Math.round(age)} seconds since heartbeat` });
}

export function buildHealthReport({ checkedAt = new Date().toISOString(), components = {}, incidents = [] } = {}) {
  const names = ["process", "database", "marketData", "analysis", "worker", "paper", "mt5", "account", "reconciliation", "risk", "execution"];
  const services = Object.fromEntries(names.map((name) => [name, normalize(name, components[name])]));
  services.execution = normalize("execution", { state: "blocked", reason: "Trading execution is disabled by configuration" });
  const states = Object.values(services).map((item) => item.state);
  const overall = states.includes("unavailable") || states.includes("stale") || states.includes("degraded") ? "degraded" : states.includes("unknown") ? "unknown" : "healthy";
  return { status: overall, checkedAt, tradingEnabled: false, liveTradingEnabled: false, services, incidents: Array.isArray(incidents) ? incidents.slice(0, 20) : [] };
}
