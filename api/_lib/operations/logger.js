import { randomUUID } from "node:crypto";

const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[_-]?key|database[_-]?url|credential)/i;
const MAX_STRING = 256;
const MAX_KEYS = 24;

function sanitize(value, depth = 0) {
  if (depth > 3) return "[truncated]";
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name, message: sanitize(value.message) };
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, MAX_KEYS).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(item, depth + 1)]));
  }
  return String(value);
}

export function sanitizeLogMetadata(metadata = {}) { return sanitize(metadata); }

export function createLogger({ sink = () => {}, now = () => new Date(), correlationFactory = randomUUID } = {}) {
  return Object.freeze({
    write({ severity = "info", component, eventType, correlationId = correlationFactory(), outcome = "observed", durationMs = null, retryCount = 0, metadata = {} }) {
      const entry = { timestamp: now().toISOString(), severity, component, eventType, correlationId, outcome, durationMs, retryCount, metadata: sanitizeLogMetadata(metadata) };
      sink(entry);
      return entry;
    }
  });
}
