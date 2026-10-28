-- Yosemite AI Milestone 12 execution-intent and reconciliation groundwork.
-- Additive only. Submission remains disabled by application configuration.

CREATE TABLE IF NOT EXISTS execution_intents (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 20 AND 120),
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  proposal_id text NOT NULL,
  proposal_version integer NOT NULL CHECK (proposal_version > 0),
  content_digest text NOT NULL CHECK (char_length(content_digest) = 64),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 20 AND 300),
  state text NOT NULL CHECK (state IN ('approved', 'execution_reserved', 'submission_initiated', 'broker_acknowledged', 'order_accepted', 'partially_filled', 'filled', 'cancel_requested', 'cancelled', 'rejected', 'submission_unknown', 'reconciliation_required')),
  broker_order_id text,
  broker_deal_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(broker_deal_ids) = 'array'),
  discrepancy text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (proposal_id, proposal_version, content_digest)
);

CREATE INDEX IF NOT EXISTS execution_intents_user_state_idx ON execution_intents (user_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS execution_intents_reconciliation_idx ON execution_intents (state, updated_at DESC) WHERE state IN ('submission_unknown', 'reconciliation_required');

CREATE TABLE IF NOT EXISTS execution_transitions (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 20 AND 120),
  execution_id text NOT NULL REFERENCES execution_intents(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS execution_transitions_execution_idx ON execution_transitions (execution_id, created_at DESC);
