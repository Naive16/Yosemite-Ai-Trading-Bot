-- Yosemite AI Milestone 3 initial schema.
-- Timestamps use PostgreSQL timestamptz; values are stored as absolute UTC instants.
-- This migration is additive and contains no destructive statements.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 20 AND 100),
  username text NOT NULL UNIQUE CHECK (char_length(username) BETWEEN 3 AND 64),
  password_hash text NOT NULL CHECK (char_length(password_hash) BETWEEN 32 AND 512),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY CHECK (char_length(token_hash) BETWEEN 32 AND 128),
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  csrf_token_hash text NOT NULL CHECK (char_length(csrf_token_hash) BETWEEN 32 AND 128),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 20 AND 100),
  user_id text REFERENCES app_users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS audit_events_user_created_idx ON audit_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_type_created_idx ON audit_events (event_type, created_at DESC);
