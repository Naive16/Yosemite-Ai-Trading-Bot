export function boundedBackoff(attempt, { baseMs = 250, maxMs = 30_000, jitter = 0.2, random = Math.random } = {}) {
  const exponent = Math.max(0, Math.floor(attempt));
  const raw = Math.min(maxMs, baseMs * (2 ** exponent));
  const factor = 1 + ((random() * 2 - 1) * Math.min(1, Math.max(0, jitter)));
  return Math.max(0, Math.round(Math.min(maxMs, raw * factor)));
}

export function shouldRetry({ operation, attempt, maxAttempts = 2, errorKind }) {
  if (operation === "broker_submission" || errorKind === "unknown_submission") return false;
  return attempt < maxAttempts && ["timeout", "rate_limit", "temporary", "database_unavailable"].includes(errorKind);
}
