-- Yosemite AI Milestone 9 immutable proposal and approval records.
-- Additive only; no existing data is deleted or rewritten.

CREATE TABLE IF NOT EXISTS trade_proposals (
  id text NOT NULL,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('pending_approval', 'blocked', 'approved', 'rejected', 'expired', 'invalidated', 'superseded')),
  content_digest text NOT NULL CHECK (char_length(content_digest) = 64),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, version),
  UNIQUE (id, version, content_digest)
);

CREATE INDEX IF NOT EXISTS trade_proposals_user_status_idx ON trade_proposals (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS trade_proposals_expiry_idx ON trade_proposals (expires_at) WHERE status = 'pending_approval';

CREATE TABLE IF NOT EXISTS trade_proposal_decisions (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 20 AND 100),
  proposal_id text NOT NULL,
  proposal_version integer NOT NULL CHECK (proposal_version > 0),
  actor_user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'invalidated', 'expired', 'superseded')),
  reason text,
  content_digest text NOT NULL CHECK (char_length(content_digest) = 64),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id, proposal_version) REFERENCES trade_proposals(id, version)
);

CREATE INDEX IF NOT EXISTS trade_proposal_decisions_proposal_idx ON trade_proposal_decisions (proposal_id, proposal_version, created_at DESC);
