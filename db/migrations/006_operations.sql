-- Yosemite AI Milestone 13 operations, alerting, leases, and recovery foundation.
-- Additive only. No trading or broker submission state is enabled by this migration.

CREATE TABLE IF NOT EXISTS operational_alerts (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 20 AND 120),
  alert_key text NOT NULL UNIQUE CHECK (char_length(alert_key) BETWEEN 3 AND 200),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 120),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  delivery_status text NOT NULL DEFAULT 'unavailable' CHECK (delivery_status IN ('unavailable', 'pending', 'delivered', 'failed')),
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  first_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_allowed_at timestamptz,
  acknowledged_at timestamptz
);
CREATE INDEX IF NOT EXISTS operational_alerts_active_idx ON operational_alerts (severity, last_seen_at DESC) WHERE acknowledged_at IS NULL;

CREATE TABLE IF NOT EXISTS worker_leases (
  worker_id text PRIMARY KEY CHECK (char_length(worker_id) BETWEEN 3 AND 128),
  status text NOT NULL CHECK (status IN ('starting', 'running', 'stopping', 'stopped', 'stale', 'failed')),
  heartbeat_at timestamptz NOT NULL,
  lease_until timestamptz NOT NULL,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS worker_leases_stale_idx ON worker_leases (lease_until, status);

CREATE TABLE IF NOT EXISTS recovery_tasks (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 20 AND 120),
  task_type text NOT NULL CHECK (char_length(task_type) BETWEEN 3 AND 120),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 3 AND 300),
  state text NOT NULL CHECK (state IN ('queued', 'leased', 'succeeded', 'failed', 'reconciliation_required', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_until timestamptz,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS recovery_tasks_queue_idx ON recovery_tasks (available_at, updated_at) WHERE state IN ('queued', 'leased');
