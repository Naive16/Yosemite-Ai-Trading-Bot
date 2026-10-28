export function recoveryDecision({ taskType, state, attempt = 0, maxAttempts = 3 } = {}) {
  if (["submission_unknown", "reconciliation_required"].includes(state) || taskType === "broker_submission") return { action: "reconcile", retry: false, reason: "Unknown broker outcomes require reconciliation before any retry" };
  if (attempt >= maxAttempts) return { action: "dead_letter", retry: false, reason: "Retry budget exhausted" };
  return { action: "retry_read_only", retry: true, reason: "Only repeatable read-only work may be retried automatically" };
}
