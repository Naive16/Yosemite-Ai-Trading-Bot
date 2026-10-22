-- Yosemite AI Milestone 10 bounded simulation state.
-- Additive only; simulated records are explicitly separated from broker records.

CREATE TABLE IF NOT EXISTS backtest_runs (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 10 AND 100),
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  results jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS backtest_runs_user_created_idx ON backtest_runs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paper_events (
  event_id text PRIMARY KEY CHECK (char_length(event_id) BETWEEN 1 AND 200),
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paper_positions (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 10 AND 100),
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  proposal_id text NOT NULL,
  proposal_version integer NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  entry_price numeric NOT NULL CHECK (entry_price > 0),
  stop_loss numeric NOT NULL CHECK (stop_loss > 0),
  take_profit numeric NOT NULL CHECK (take_profit > 0),
  status text NOT NULL CHECK (status IN ('open', 'closed', 'skipped')),
  simulated boolean NOT NULL DEFAULT true CHECK (simulated = true),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS paper_positions_user_status_idx ON paper_positions (user_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS paper_trades (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 10 AND 100),
  position_id text NOT NULL REFERENCES paper_positions(id),
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  gross_pnl numeric NOT NULL,
  estimated_costs numeric NOT NULL DEFAULT 0,
  net_pnl numeric NOT NULL,
  simulated boolean NOT NULL DEFAULT true CHECK (simulated = true),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL
);
