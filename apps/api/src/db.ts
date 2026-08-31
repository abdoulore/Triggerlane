import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
}

let databasePromise: Promise<PGlite> | undefined;

const migration = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  generation INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  data_mode TEXT NOT NULL DEFAULT 'DEMO',
  demo_step INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS portfolios_one_active_user ON portfolios(user_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS balances (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  asset TEXT NOT NULL,
  quantity_decimal NUMERIC(38, 18) NOT NULL,
  cost_basis_usdc_decimal NUMERIC(38, 6),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(portfolio_id, asset)
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  type TEXT NOT NULL,
  execution_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  asset TEXT NOT NULL,
  amount_decimal NUMERIC(38, 18) NOT NULL,
  cost_basis_delta_usdc_decimal NUMERIC(38, 6),
  unit_price_usdc_decimal NUMERIC(38, 6),
  type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ghosts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  name TEXT NOT NULL,
  side TEXT NOT NULL,
  amount_decimal NUMERIC(38, 9) NOT NULL,
  amount_type TEXT NOT NULL,
  max_slippage_bps INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  conditions JSONB NOT NULL,
  evaluations JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL,
  pause_reason TEXT,
  configuration_version INTEGER NOT NULL DEFAULT 1,
  trigger_proximity NUMERIC(8, 6) NOT NULL DEFAULT 0,
  was_qualified BOOLEAN NOT NULL DEFAULT FALSE,
  reservation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  armed_at TIMESTAMPTZ,
  triggered_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS capital_reservations (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  ghost_id TEXT NOT NULL REFERENCES ghosts(id),
  asset TEXT NOT NULL,
  amount_decimal NUMERIC(38, 18) NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_open_ghost
  ON capital_reservations(ghost_id) WHERE status IN ('ACTIVE', 'LOCKED');

CREATE TABLE IF NOT EXISTS capital_reservation_events (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES capital_reservations(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS market_observations (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  metric TEXT NOT NULL,
  value_decimal NUMERIC(38, 18) NOT NULL,
  unit TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_sequence INTEGER,
  provenance TEXT NOT NULL,
  source_timestamp TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL,
  portfolio_version INTEGER
);

CREATE TABLE IF NOT EXISTS evaluation_frames (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  market TEXT NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  assembled_at TIMESTAMPTZ NOT NULL,
  mode TEXT NOT NULL,
  completeness TEXT NOT NULL,
  execution_eligible BOOLEAN NOT NULL,
  observations JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_attempts (
  id TEXT PRIMARY KEY,
  ghost_id TEXT NOT NULL REFERENCES ghosts(id),
  configuration_version INTEGER NOT NULL,
  trigger_frame_id TEXT NOT NULL REFERENCES evaluation_frames(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(ghost_id, configuration_version, trigger_frame_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_inflight_ghost
  ON execution_attempts(ghost_id) WHERE status IN ('LOCKED', 'SETTLING');

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  ghost_id TEXT NOT NULL REFERENCES ghosts(id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  attempt_id TEXT NOT NULL REFERENCES execution_attempts(id),
  status TEXT NOT NULL,
  input_asset TEXT NOT NULL,
  input_amount NUMERIC(38, 18) NOT NULL,
  output_asset TEXT NOT NULL,
  output_amount NUMERIC(38, 18) NOT NULL,
  trigger_price NUMERIC(38, 6) NOT NULL,
  execution_price NUMERIC(38, 6) NOT NULL,
  modeled_slippage_bps INTEGER NOT NULL,
  quote_model_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  trigger_frame_id TEXT NOT NULL REFERENCES evaluation_frames(id),
  settlement_frame_id TEXT NOT NULL REFERENCES evaluation_frames(id),
  reservation_id TEXT NOT NULL REFERENCES capital_reservations(id),
  receipt JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS executions_one_fill_ghost ON executions(ghost_id) WHERE status = 'FILLED';

CREATE TABLE IF NOT EXISTS ghost_activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  ghost_id TEXT REFERENCES ghosts(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_leases (
  partition_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  delivery_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_unpublished ON outbox_events(created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id TEXT NOT NULL REFERENCES users(id),
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  resource_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(user_id, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_events_name_created ON analytics_events(event_name, created_at DESC);

CREATE TABLE IF NOT EXISTS backtests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id),
  period TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  draft JSONB NOT NULL,
  summary JSONB NOT NULL,
  points JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS backtest_triggers (
  id TEXT PRIMARY KEY,
  backtest_id TEXT NOT NULL REFERENCES backtests(id),
  frame_id TEXT NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL,
  values JSONB NOT NULL,
  UNIQUE(backtest_id, frame_id)
);

CREATE TABLE IF NOT EXISTS strategy_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  thesis TEXT NOT NULL,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  metrics JSONB NOT NULL,
  draft JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL
);
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (1, 'initial_ghost_orders', NOW())
ON CONFLICT (version) DO NOTHING;

CREATE INDEX IF NOT EXISTS ghosts_user_created ON ghosts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activities_user_created ON ghost_activities(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS executions_portfolio_created ON executions(portfolio_id, completed_at DESC);
`;

export async function createDatabase(dataDir?: string): Promise<PGlite> {
  const directory = dataDir ?? process.env.PGLITE_DATA_DIR ?? path.resolve(process.cwd(), "../../.data/ghost-orders");
  if (directory !== ":memory:") mkdirSync(directory, { recursive: true });
  const database = directory === ":memory:" ? await PGlite.create() : await PGlite.create(directory);
  await database.exec(migration);
  return database;
}

export async function getDatabase(): Promise<PGlite> {
  databasePromise ??= createDatabase();
  return databasePromise;
}

export async function rows<T extends Record<string, unknown>>(
  db: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T extends Record<string, unknown>>(
  db: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}
