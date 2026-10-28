-- Yosemite AI Milestone 8 risk state.
-- Additive only: no existing data is deleted or rewritten.

CREATE TABLE IF NOT EXISTS risk_configurations (
  version text PRIMARY KEY CHECK (char_length(version) BETWEEN 1 AND 64),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS risk_configurations_active_idx ON risk_configurations (active) WHERE active;

CREATE TABLE IF NOT EXISTS risk_daily_state (
  trading_day_key date PRIMARY KEY,
  time_zone text NOT NULL,
  account_currency text NOT NULL CHECK (char_length(account_currency) = 3),
  daily_start_equity numeric NOT NULL CHECK (daily_start_equity > 0),
  realized_pnl numeric NOT NULL DEFAULT 0,
  loss_streak integer NOT NULL DEFAULT 0 CHECK (loss_streak >= 0),
  cooling_until timestamptz,
  source text NOT NULL,
  captured_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS risk_account_snapshots (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 20 AND 100),
  account_currency text NOT NULL CHECK (char_length(account_currency) = 3),
  equity numeric NOT NULL CHECK (equity > 0),
  unrealized_pnl numeric NOT NULL DEFAULT 0,
  source text NOT NULL,
  is_simulated boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS risk_account_snapshots_captured_idx ON risk_account_snapshots (captured_at DESC);

CREATE TABLE IF NOT EXISTS risk_position_snapshots (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 20 AND 100),
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  volume numeric NOT NULL CHECK (volume > 0),
  exposure numeric NOT NULL CHECK (exposure >= 0),
  correlation_group text,
  source text NOT NULL,
  captured_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS risk_position_snapshots_captured_idx ON risk_position_snapshots (captured_at DESC);

CREATE TABLE IF NOT EXISTS risk_evaluations (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 20 AND 120),
  user_id text REFERENCES app_users(id) ON DELETE SET NULL,
  candidate_id text,
  decision text NOT NULL CHECK (decision IN ('PASS', 'REJECT', 'BLOCKED')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  inputs jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  configuration_version text NOT NULL REFERENCES risk_configurations(version),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS risk_evaluations_user_created_idx ON risk_evaluations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS risk_evaluations_decision_created_idx ON risk_evaluations (decision, created_at DESC);
