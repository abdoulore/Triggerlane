import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import Decimal from "decimal.js";
import { z } from "zod";
import {
  DEMO_FRAMES,
  STRATEGY_TEMPLATES,
  aiComposeRequestSchema,
  buildSandboxQuote,
  calculatePnlRatio,
  evaluateGhost,
  evaluateReplay,
  ghostIntelligence,
  ghostDraftSchema,
  compileGhostIR,
  parseGhostPrompt,
  type ConditionResult,
  type DataMode,
  type EvaluationFrame,
  type GhostDraft,
  type Metric,
  type MetricObservation,
} from "@ghost/domain";
import { one, rows, type Queryable } from "./db.js";
import { SandboxAutomationAdapter } from "./integrations/sandbox/sandbox-automation-adapter.js";
import { RialoAutomationAdapter } from "./integrations/rialo/rialo-automation-adapter.js";

type JsonValue = Record<string, unknown> | unknown[];

interface PortfolioRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  data_mode: DataMode;
  demo_step: number;
  version: number;
  generation: number;
}

interface BalanceRow extends Record<string, unknown> {
  asset: "SOL" | "USDC";
  quantity_decimal: string;
  cost_basis_usdc_decimal: string | null;
  reserved_decimal?: string;
}

interface GhostRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  portfolio_id: string;
  name: string;
  side: "BUY" | "SELL";
  amount_decimal: string;
  amount_type: "USDC" | "POSITION_PERCENT";
  max_slippage_bps: number;
  expires_at: string;
  conditions: GhostDraft["conditions"];
  evaluations: ConditionResult[];
  status: string;
  pause_reason: string | null;
  configuration_version: number;
  trigger_proximity: string;
  was_qualified: boolean;
  reservation_id: string | null;
  created_at: string;
  armed_at: string | null;
  triggered_at: string | null;
  executed_at: string | null;
  updated_at: string;
}

interface ReservationRow extends Record<string, unknown> {
  id: string;
  portfolio_id: string;
  ghost_id: string;
  asset: "SOL" | "USDC";
  amount_decimal: string;
  status: "ACTIVE" | "LOCKED" | "CONSUMED" | "RELEASED";
  version: number;
}

interface FrameRow extends Record<string, unknown> {
  id: string;
  market: "SOL/USDC";
  cutoff_at: string;
  assembled_at: string;
  mode: DataMode;
  completeness: "COMPLETE" | "INCOMPLETE" | "STALE";
  execution_eligible: boolean;
  observations: Record<Metric, MetricObservation>;
}

interface SessionRow extends Record<string, unknown> {
  user_id: string;
  expires_at: string;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function now(): string {
  return new Date().toISOString();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function frameFromRow(row: FrameRow): EvaluationFrame {
  return {
    id: row.id,
    market: row.market,
    cutoffAt: new Date(row.cutoff_at).toISOString(),
    assembledAt: new Date(row.assembled_at).toISOString(),
    mode: row.mode,
    completeness: row.completeness,
    executionEligible: row.execution_eligible,
    observations: parseJson(row.observations),
  };
}

function publicGhost(row: GhostRow) {
  return {
    id: row.id,
    name: row.name,
    side: row.side,
    amount: row.amount_decimal,
    amountType: row.amount_type,
    maxSlippageBps: row.max_slippage_bps,
    expiresAt: new Date(row.expires_at).toISOString(),
    conditions: parseJson(row.conditions),
    evaluations: parseJson(row.evaluations),
    status: row.status,
    pauseReason: row.pause_reason,
    configurationVersion: row.configuration_version,
    triggerProximity: row.trigger_proximity,
    reservationId: row.reservation_id,
    createdAt: new Date(row.created_at).toISOString(),
    armedAt: row.armed_at ? new Date(row.armed_at).toISOString() : null,
    triggeredAt: row.triggered_at ? new Date(row.triggered_at).toISOString() : null,
    executedAt: row.executed_at ? new Date(row.executed_at).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class GhostService {
  private readonly executionAdapters = [new SandboxAutomationAdapter(), new RialoAutomationAdapter()];

  constructor(private readonly database: PGlite) {}

  executionTargets() {
    return {
      architecture: { current: "Live data -> GhostIR -> Simulation", target: "Live data -> GhostIR -> Rialo reactive execution" },
      targets: this.executionAdapters.map((adapter) => adapter.capabilities),
    };
  }

  compilerPreview(payload: unknown) {
    const draft = ghostDraftSchema.parse(payload);
    const ir = compileGhostIR(draft);
    return {
      ir,
      compilations: this.executionAdapters.map((adapter) => adapter.compile(ir)),
      networkArtifacts: null,
      notice: "No Rialo deployment, transaction, block, gas, confirmation, or explorer artifact has been created.",
    };
  }

  async createAnonymousSession(): Promise<{ token: string; userId: string; expiresAt: string }> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const userId = randomUUID();
    const sessionId = randomUUID();
    const portfolioId = randomUUID();
    const createdAt = now();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await this.database.transaction(async (tx) => {
      await tx.query("INSERT INTO users (id, created_at) VALUES ($1, $2)", [userId, createdAt]);
      await tx.query(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $5)",
        [sessionId, userId, tokenHash, expiresAt, createdAt],
      );
      await tx.query(
        "INSERT INTO portfolios (id, user_id, generation, status, data_mode, demo_step, version, created_at, updated_at) VALUES ($1, $2, 1, 'ACTIVE', 'DEMO', 0, 1, $3, $3)",
        [portfolioId, userId, createdAt],
      );
      await tx.query(
        "INSERT INTO balances (id, portfolio_id, asset, quantity_decimal, cost_basis_usdc_decimal, version, updated_at) VALUES ($1, $2, 'USDC', 15000, NULL, 1, $3), ($4, $2, 'SOL', 40, 10000, 1, $3)",
        [randomUUID(), portfolioId, createdAt, randomUUID()],
      );
      const ledgerId = randomUUID();
      await tx.query(
        "INSERT INTO ledger_transactions (id, portfolio_id, type, idempotency_key, created_at) VALUES ($1, $2, 'SEED', $3, $4)",
        [ledgerId, portfolioId, `seed:${portfolioId}`, createdAt],
      );
      await tx.query(
        "INSERT INTO ledger_entries (id, transaction_id, portfolio_id, asset, amount_decimal, cost_basis_delta_usdc_decimal, unit_price_usdc_decimal, type, created_at) VALUES ($1, $2, $3, 'USDC', 15000, NULL, 1, 'SEED', $4), ($5, $2, $3, 'SOL', 40, 10000, 250, 'SEED', $4)",
        [randomUUID(), ledgerId, portfolioId, createdAt, randomUUID()],
      );
      await this.addActivity(tx, userId, null, "SANDBOX_READY", "Simulation funded with 15,000 virtual USDC and 40 virtual SOL.", {
        portfolioId,
      });
      await this.createDemoFrame(tx, { id: portfolioId, user_id: userId, data_mode: "DEMO", demo_step: 0, version: 1, generation: 1 }, 0);
    });

    return { token, userId, expiresAt };
  }

  async resolveSession(token: string | undefined): Promise<{ userId: string; expiresAt: string } | null> {
    if (!token) return null;
    const session = await one<SessionRow>(
      this.database,
      "SELECT user_id, expires_at FROM sessions WHERE token_hash = $1 AND expires_at > NOW()",
      [hashToken(token)],
    );
    if (!session) return null;
    await this.database.query("UPDATE sessions SET last_seen_at = NOW() WHERE token_hash = $1", [hashToken(token)]);
    return { userId: session.user_id, expiresAt: new Date(session.expires_at).toISOString() };
  }

  async deleteSession(token: string): Promise<void> {
    await this.database.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  }

  private async activePortfolio(db: Queryable, userId: string): Promise<PortfolioRow> {
    const portfolio = await one<PortfolioRow>(
      db,
      "SELECT id, user_id, data_mode, demo_step, version, generation FROM portfolios WHERE user_id = $1 AND status = 'ACTIVE'",
      [userId],
    );
    if (!portfolio) throw new AppError("PORTFOLIO_NOT_FOUND", "Simulation portfolio was not found.", 404);
    return portfolio;
  }

  private async addActivity(
    db: Queryable,
    userId: string,
    ghostId: string | null,
    type: string,
    message: string,
    metadata: JsonValue = {},
  ): Promise<void> {
    const activityId = randomUUID();
    const createdAt = now();
    await db.query(
      "INSERT INTO ghost_activities (id, user_id, ghost_id, type, message, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [activityId, userId, ghostId, type, message, JSON.stringify(metadata), createdAt],
    );
    const eventType = type === "FILLED" ? "ghost.execution.completed"
      : type === "EXECUTION_STARTED" ? "ghost.execution.started"
      : type === "EXECUTION_BLOCKED" ? "ghost.execution.failed"
      : type === "TRIGGERED" ? "ghost.triggered"
      : type === "DATA_MODE_CHANGED" ? "market.connection.updated"
      : type === "SANDBOX_READY" ? "portfolio.updated"
      : type.startsWith("STRATEGY_") ? "strategy.updated"
      : type === "REPLAY_COMPLETED" ? "replay.completed"
      : "ghost.status.updated";
    await db.query(
      "INSERT INTO outbox_events (id, user_id, event_type, payload, created_at) VALUES ($1, $2, $3, $4, $5)",
      [randomUUID(), userId, eventType, JSON.stringify({ activityId, ghostId, activityType: type, at: createdAt }), createdAt],
    );
  }

  async trackAnalytics(userId: string | null, eventName: string, properties: JsonValue = {}): Promise<void> {
    await this.database.query(
      "INSERT INTO analytics_events (id, user_id, event_name, properties, created_at) VALUES ($1, $2, $3, $4, NOW())",
      [randomUUID(), userId, eventName, JSON.stringify(properties)],
    );
  }

  async markets() {
    return { markets: [{ asset: "SOL", quoteAsset: "USDC", symbol: "SOL/USDC", metrics: ["PRICE", "FUNDING", "PNL"], modes: ["DEMO", "LIVE"], liveExecutionEligible: false }] };
  }

  async market(asset: string) {
    if (asset.toUpperCase() !== "SOL") throw new AppError("MARKET_NOT_FOUND", "Only SOL/USDC is supported.", 404);
    return (await this.markets()).markets[0];
  }

  async dataMode(userId: string) {
    const portfolio = await this.activePortfolio(this.database, userId);
    return { mode: portfolio.data_mode, executionEligible: portfolio.data_mode === "DEMO" };
  }

  async portfolio(userId: string) {
    return (await this.workspace(userId)).portfolio;
  }

  async resetPortfolio(userId: string, idempotencyKey: string) {
    await this.database.transaction(async (tx) => {
      const replay = await one<Record<string, unknown>>(tx, "SELECT resource_id FROM idempotency_records WHERE user_id=$1 AND operation='RESET_PORTFOLIO' AND idempotency_key=$2", [userId, idempotencyKey]);
      if (replay) return;
      const current = await this.activePortfolio(tx, userId);
      const inflight = await one<{ count: string }>(tx, "SELECT COUNT(*)::text AS count FROM execution_attempts ea JOIN ghosts g ON g.id=ea.ghost_id WHERE g.portfolio_id=$1 AND ea.status IN ('LOCKED','SETTLING')", [current.id]);
      if (Number(inflight?.count ?? 0) > 0) throw new AppError("EXECUTION_IN_FLIGHT", "Portfolio reset is unavailable while an execution is in flight.", 409);
      const timestamp = now();
      const portfolioId = randomUUID();
      const ledgerId = randomUUID();
      await tx.query("UPDATE portfolios SET status='ARCHIVED', updated_at=$1 WHERE id=$2", [timestamp, current.id]);
      await tx.query("INSERT INTO portfolios (id,user_id,generation,status,data_mode,demo_step,version,created_at,updated_at) VALUES ($1,$2,$3,'ACTIVE','DEMO',0,1,$4,$4)", [portfolioId, userId, current.generation + 1, timestamp]);
      await tx.query("INSERT INTO balances (id,portfolio_id,asset,quantity_decimal,cost_basis_usdc_decimal,version,updated_at) VALUES ($1,$2,'USDC',15000,NULL,1,$3),($4,$2,'SOL',40,10000,1,$3)", [randomUUID(), portfolioId, timestamp, randomUUID()]);
      await tx.query("INSERT INTO ledger_transactions (id,portfolio_id,type,idempotency_key,created_at) VALUES ($1,$2,'SEED',$3,$4)", [ledgerId, portfolioId, `seed:${portfolioId}`, timestamp]);
      await tx.query("INSERT INTO ledger_entries (id,transaction_id,portfolio_id,asset,amount_decimal,cost_basis_delta_usdc_decimal,unit_price_usdc_decimal,type,created_at) VALUES ($1,$2,$3,'USDC',15000,NULL,1,'SEED_CREDIT',$4),($5,$2,$3,'SOL',40,10000,250,'SEED_CREDIT',$4)", [randomUUID(), ledgerId, portfolioId, timestamp, randomUUID()]);
      await tx.query("INSERT INTO idempotency_records (user_id,operation,idempotency_key,resource_id,created_at) VALUES ($1,'RESET_PORTFOLIO',$2,$3,$4)", [userId, idempotencyKey, portfolioId, timestamp]);
      await this.addActivity(tx, userId, null, "SANDBOX_RESET", "Simulation portfolio reset to its seeded state.", { portfolioId, generation: current.generation + 1 });
    });
    return this.workspace(userId);
  }

  async ghosts(userId: string) {
    return (await this.workspace(userId)).ghosts;
  }

  async ghostActivity(userId: string, ghostId: string) {
    await this.ghost(userId, ghostId);
    const activity = await rows<Record<string, unknown>>(this.database, "SELECT id, ghost_id, type, message, metadata, created_at FROM ghost_activities WHERE user_id = $1 AND ghost_id = $2 ORDER BY created_at DESC", [userId, ghostId]);
    return activity.map((item) => ({ ...item, metadata: parseJson(item.metadata as JsonValue), created_at: new Date(item.created_at as string).toISOString() }));
  }

  async history(userId: string) {
    const workspace = await this.workspace(userId);
    return { executions: workspace.executions, attempts: workspace.executionAttempts, ghosts: workspace.ghosts.filter((ghost) => ["FILLED", "CANCELLED", "EXPIRED", "FAILED"].includes(ghost.status)) };
  }

  async execution(userId: string, executionId: string) {
    const row = await one<Record<string, unknown>>(this.database, "SELECT e.*, g.name AS ghost_name FROM executions e JOIN ghosts g ON g.id = e.ghost_id WHERE e.id = $1 AND g.user_id = $2", [executionId, userId]);
    if (!row) throw new AppError("EXECUTION_NOT_FOUND", "Execution was not found.", 404);
    return { ...row, receipt: parseJson(row.receipt as JsonValue), completed_at: new Date(row.completed_at as string).toISOString() };
  }

  async updateGhost(userId: string, ghostId: string, payload: unknown) {
    const request = z.object({ expectedConfigurationVersion: z.number().int().positive(), draft: ghostDraftSchema }).parse(payload);
    const existing = await one<GhostRow>(this.database, "SELECT * FROM ghosts WHERE id = $1 AND user_id = $2", [ghostId, userId]);
    if (!existing) throw new AppError("GHOST_NOT_FOUND", "Trigger was not found.", 404);
    if (existing.status !== "DRAFT") throw new AppError("INVALID_STATE", "Only a draft trigger can be edited.", 409);
    if (existing.configuration_version !== request.expectedConfigurationVersion) throw new AppError("CONFIGURATION_CONFLICT", "This trigger changed since it was opened. Refresh and try again.", 409);
    const portfolio = await this.activePortfolio(this.database, userId);
    const frame = await this.latestFrame(this.database, portfolio.id);
    if (!frame) throw new AppError("FRAME_NOT_FOUND", "Market frame is not ready.", 503);
    const evaluations = evaluateGhost(request.draft.conditions, frame);
    const expiresAt = new Date(Date.now() + request.draft.expiresInHours * 60 * 60 * 1000).toISOString();
    await this.database.query(`UPDATE ghosts SET name=$1, side=$2, amount_decimal=$3, amount_type=$4, max_slippage_bps=$5, expires_at=$6, conditions=$7, evaluations=$8, configuration_version=configuration_version+1, trigger_proximity=$9, updated_at=NOW() WHERE id=$10 AND user_id=$11`, [request.draft.name, request.draft.side, request.draft.amount, request.draft.amountType, request.draft.maxSlippageBps, expiresAt, JSON.stringify(request.draft.conditions), JSON.stringify(evaluations), evaluations.filter((item) => item.satisfied).length / evaluations.length, ghostId, userId]);
    await this.addActivity(this.database, userId, ghostId, "CONFIGURATION_UPDATED", "Draft configuration updated.", { configurationVersion: existing.configuration_version + 1 });
    return this.ghost(userId, ghostId);
  }

  async publishOutbox(publish: (userId: string, event: Record<string, unknown>) => void): Promise<number> {
    const pending = await rows<{ id: string; user_id: string; event_type: string; payload: JsonValue }>(
      this.database,
      "SELECT id, user_id, event_type, payload FROM outbox_events WHERE published_at IS NULL ORDER BY created_at LIMIT 100",
    );
    for (const event of pending) {
      publish(event.user_id, { type: event.event_type, ...parseJson(event.payload) as Record<string, unknown> });
      await this.database.query(
        "UPDATE outbox_events SET published_at = NOW(), delivery_count = delivery_count + 1 WHERE id = $1 AND published_at IS NULL",
        [event.id],
      );
    }
    return pending.length;
  }

  async acquireWorkerLease(ownerId: string, ttlSeconds = 15): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO worker_leases (partition_key, owner_id, acquired_at, heartbeat_at, expires_at)
       VALUES ('SOL/USDC', $1, NOW(), NOW(), NOW() + ($2 * INTERVAL '1 second'))
       ON CONFLICT (partition_key) DO UPDATE SET owner_id = EXCLUDED.owner_id, heartbeat_at = NOW(), expires_at = EXCLUDED.expires_at
       WHERE worker_leases.owner_id = EXCLUDED.owner_id OR worker_leases.expires_at < NOW()
       RETURNING owner_id`,
      [ownerId, ttlSeconds],
    );
    return Boolean(result.rows[0]);
  }

  private async latestFrame(db: Queryable, portfolioId: string): Promise<EvaluationFrame | null> {
    const row = await one<FrameRow>(
      db,
      "SELECT * FROM evaluation_frames WHERE portfolio_id = $1 ORDER BY assembled_at DESC LIMIT 1",
      [portfolioId],
    );
    return row ? frameFromRow(row) : null;
  }

  private async createDemoFrame(db: Queryable, portfolio: PortfolioRow, step: number): Promise<EvaluationFrame> {
    const frameValue = DEMO_FRAMES[step % DEMO_FRAMES.length] ?? DEMO_FRAMES[0];
    const sol = await one<BalanceRow>(
      db,
      "SELECT asset, quantity_decimal::text, cost_basis_usdc_decimal::text FROM balances WHERE portfolio_id = $1 AND asset = 'SOL'",
      [portfolio.id],
    );
    if (!sol) throw new AppError("BALANCE_NOT_FOUND", "SOL balance was not found.", 500);

    const timestamp = now();
    const priceId = randomUUID();
    const fundingId = randomUUID();
    const pnlId = randomUUID();
    const sequence = step + 1;
    const pnl = calculatePnlRatio(sol.quantity_decimal, sol.cost_basis_usdc_decimal ?? "0", frameValue.price);
    const observations: EvaluationFrame["observations"] = {
      PRICE: {
        id: priceId,
        metric: "PRICE",
        value: frameValue.price,
        unit: "USDC_PER_SOL",
        provider: "ghost-demo-feed",
        providerSequence: sequence,
        sourceTimestamp: timestamp,
        receivedAt: timestamp,
        provenance: "DEMO",
      },
      FUNDING: {
        id: fundingId,
        metric: "FUNDING",
        value: frameValue.funding,
        unit: "RATIO",
        provider: "ghost-demo-feed",
        providerSequence: sequence,
        sourceTimestamp: timestamp,
        receivedAt: timestamp,
        provenance: "DEMO",
      },
      PNL: {
        id: pnlId,
        metric: "PNL",
        value: pnl,
        unit: "RATIO",
        provider: "sandbox-ledger",
        providerSequence: sequence,
        sourceTimestamp: timestamp,
        receivedAt: timestamp,
        provenance: "DEMO",
        portfolioVersion: portfolio.version,
        derivedFromObservationIds: [priceId],
      },
    };

    for (const observation of Object.values(observations)) {
      await db.query(
        "INSERT INTO market_observations (id, portfolio_id, metric, value_decimal, unit, provider, provider_sequence, provenance, source_timestamp, received_at, portfolio_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        [
          observation.id,
          portfolio.id,
          observation.metric,
          observation.value,
          observation.unit,
          observation.provider,
          observation.providerSequence ?? null,
          observation.provenance,
          observation.sourceTimestamp,
          observation.receivedAt,
          observation.portfolioVersion ?? null,
        ],
      );
    }

    const frame: EvaluationFrame = {
      id: randomUUID(),
      market: "SOL/USDC",
      cutoffAt: timestamp,
      assembledAt: timestamp,
      mode: "DEMO",
      completeness: "COMPLETE",
      executionEligible: true,
      observations,
    };
    await db.query(
      "INSERT INTO evaluation_frames (id, portfolio_id, market, cutoff_at, assembled_at, mode, completeness, execution_eligible, observations) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        frame.id,
        portfolio.id,
        frame.market,
        frame.cutoffAt,
        frame.assembledAt,
        frame.mode,
        frame.completeness,
        frame.executionEligible,
        JSON.stringify(frame.observations),
      ],
    );
    return frame;
  }

  async workspace(userId: string) {
    const portfolio = await this.activePortfolio(this.database, userId);
    let frame = await this.latestFrame(this.database, portfolio.id);
    frame ??= await this.createDemoFrame(this.database, portfolio, portfolio.demo_step);

    const balanceRows = await rows<BalanceRow>(
      this.database,
      `SELECT b.asset, b.quantity_decimal::text, b.cost_basis_usdc_decimal::text,
        COALESCE(SUM(r.amount_decimal) FILTER (WHERE r.status IN ('ACTIVE', 'LOCKED')), 0)::text AS reserved_decimal
       FROM balances b
       LEFT JOIN capital_reservations r ON r.portfolio_id = b.portfolio_id AND r.asset = b.asset
       WHERE b.portfolio_id = $1
       GROUP BY b.id, b.asset, b.quantity_decimal, b.cost_basis_usdc_decimal
       ORDER BY b.asset`,
      [portfolio.id],
    );
    const ghostRows = await rows<GhostRow>(
      this.database,
      "SELECT * FROM ghosts WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    const activityRows = await rows<Record<string, unknown>>(
      this.database,
      "SELECT id, ghost_id, type, message, metadata, created_at FROM ghost_activities WHERE user_id = $1 ORDER BY created_at DESC LIMIT 40",
      [userId],
    );
    const executionRows = await rows<Record<string, unknown>>(
      this.database,
      "SELECT e.*, g.name AS ghost_name FROM executions e JOIN ghosts g ON g.id = e.ghost_id WHERE e.portfolio_id = $1 ORDER BY e.completed_at DESC",
      [portfolio.id],
    );
    const attemptRows = await rows<Record<string, unknown>>(
      this.database,
      `SELECT ea.id, ea.ghost_id, ea.configuration_version, ea.trigger_frame_id, ea.status, ea.created_at, ea.updated_at,
        g.name AS ghost_name, g.side, g.amount_decimal::text, g.amount_type, g.max_slippage_bps, g.conditions,
        r.id AS reservation_id, r.asset AS reservation_asset, r.amount_decimal::text AS reservation_amount, r.status AS reservation_status,
        f.cutoff_at AS frame_cutoff_at, f.assembled_at AS frame_assembled_at, f.mode AS frame_mode,
        f.completeness AS frame_completeness, f.execution_eligible AS frame_execution_eligible, f.observations AS frame_observations
       FROM execution_attempts ea
       JOIN ghosts g ON g.id = ea.ghost_id
       JOIN evaluation_frames f ON f.id = ea.trigger_frame_id
       LEFT JOIN capital_reservations r ON r.id = g.reservation_id
       WHERE g.portfolio_id = $1 AND ea.status = 'BLOCKED'
       ORDER BY ea.updated_at DESC`,
      [portfolio.id],
    );
    const blockedActivityRows = await rows<Record<string, unknown>>(
      this.database,
      `SELECT id, ghost_id, message, metadata, created_at
       FROM ghost_activities
       WHERE user_id = $1 AND type = 'EXECUTION_BLOCKED'
       ORDER BY created_at DESC`,
      [userId],
    );
    const ledgerTransactionRows = await rows<Record<string, unknown>>(
      this.database,
      `SELECT lt.id, lt.type, lt.execution_id, lt.created_at, e.ghost_id, g.name AS ghost_name
       FROM ledger_transactions lt
       LEFT JOIN executions e ON e.id = lt.execution_id
       LEFT JOIN ghosts g ON g.id = e.ghost_id
       WHERE lt.portfolio_id = $1
       ORDER BY lt.created_at DESC`,
      [portfolio.id],
    );
    const ledgerEntryRows = await rows<Record<string, unknown>>(
      this.database,
      `SELECT id, transaction_id, asset, amount_decimal::text, cost_basis_delta_usdc_decimal::text,
        unit_price_usdc_decimal::text, type, created_at
       FROM ledger_entries
       WHERE portfolio_id = $1
       ORDER BY created_at DESC, asset`,
      [portfolio.id],
    );
    const reservationRows = await rows<Record<string, unknown>>(
      this.database,
      `SELECT r.id, r.ghost_id, g.name AS ghost_name, g.side, r.asset, r.amount_decimal::text,
        r.status, r.created_at, r.updated_at
       FROM capital_reservations r
       JOIN ghosts g ON g.id = r.ghost_id
       WHERE r.portfolio_id = $1
       ORDER BY r.updated_at DESC`,
      [portfolio.id],
    );

    const balances = Object.fromEntries(
      balanceRows.map((balance) => {
        const quantity = new Decimal(balance.quantity_decimal);
        const reserved = new Decimal(balance.reserved_decimal ?? 0);
        return [
          balance.asset,
          {
            asset: balance.asset,
            quantity: quantity.toFixed(),
            reserved: reserved.toFixed(),
            available: quantity.minus(reserved).toFixed(),
            costBasisUsdc: balance.cost_basis_usdc_decimal,
          },
        ];
      }),
    );

    return {
      identity: { id: userId, label: `Simulation ${userId.slice(0, 4).toUpperCase()}` },
      portfolio: {
        id: portfolio.id,
        dataMode: portfolio.data_mode,
        demoStep: portfolio.demo_step,
        version: portfolio.version,
        balances,
      },
      frame,
      ghosts: ghostRows.map(publicGhost),
      activities: activityRows.map((activity) => ({
        ...activity,
        metadata: parseJson(activity.metadata as JsonValue),
        created_at: new Date(activity.created_at as string).toISOString(),
      })),
      executions: executionRows.map((execution) => ({
        ...execution,
        receipt: parseJson(execution.receipt as JsonValue),
        completed_at: new Date(execution.completed_at as string).toISOString(),
      })),
      executionAttempts: attemptRows.map((attempt) => {
        const reason = blockedActivityRows.find((activity) => activity.ghost_id === attempt.ghost_id && Math.abs(new Date(activity.created_at as string).getTime() - new Date(attempt.updated_at as string).getTime()) < 5000);
        return {
          id: attempt.id,
          ghostId: attempt.ghost_id,
          ghostName: attempt.ghost_name,
          configurationVersion: attempt.configuration_version,
          status: attempt.status,
          side: attempt.side,
          amount: attempt.amount_decimal,
          amountType: attempt.amount_type,
          maxSlippageBps: attempt.max_slippage_bps,
          conditions: parseJson(attempt.conditions as JsonValue),
          createdAt: new Date(attempt.created_at as string).toISOString(),
          updatedAt: new Date(attempt.updated_at as string).toISOString(),
          reason: reason ? { message: reason.message, metadata: parseJson(reason.metadata as JsonValue), createdAt: new Date(reason.created_at as string).toISOString() } : null,
          reservation: attempt.reservation_id ? { id: attempt.reservation_id, asset: attempt.reservation_asset, amount: attempt.reservation_amount, status: attempt.reservation_status } : null,
          frame: {
            id: attempt.trigger_frame_id,
            cutoffAt: new Date(attempt.frame_cutoff_at as string).toISOString(),
            assembledAt: new Date(attempt.frame_assembled_at as string).toISOString(),
            mode: attempt.frame_mode,
            completeness: attempt.frame_completeness,
            executionEligible: attempt.frame_execution_eligible,
            observations: parseJson(attempt.frame_observations as JsonValue),
          },
        };
      }),
      ledger: ledgerTransactionRows.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        executionId: transaction.execution_id,
        ghostId: transaction.ghost_id,
        ghostName: transaction.ghost_name,
        createdAt: new Date(transaction.created_at as string).toISOString(),
        entries: ledgerEntryRows.filter((entry) => entry.transaction_id === transaction.id).map((entry) => ({
          id: entry.id,
          asset: entry.asset,
          amount: entry.amount_decimal,
          costBasisDeltaUsdc: entry.cost_basis_delta_usdc_decimal,
          unitPriceUsdc: entry.unit_price_usdc_decimal,
          type: entry.type,
          createdAt: new Date(entry.created_at as string).toISOString(),
        })),
      })),
      reservations: reservationRows.map((reservation) => ({
        id: reservation.id,
        ghostId: reservation.ghost_id,
        ghostName: reservation.ghost_name,
        side: reservation.side,
        asset: reservation.asset,
        amount: reservation.amount_decimal,
        status: reservation.status,
        createdAt: new Date(reservation.created_at as string).toISOString(),
        updatedAt: new Date(reservation.updated_at as string).toISOString(),
      })),
    };
  }

  async composeGhost(userId: string, payload: unknown) {
    const request = aiComposeRequestSchema.parse(payload);
    const workspace = await this.workspace(userId);
    const parsed = parseGhostPrompt(request.prompt, request.baseDraft);
    return {
      ...parsed,
      insights: ghostIntelligence(parsed.draft, workspace.frame.observations),
      parser: { mode: "DETERMINISTIC", modelProvider: null, supportedMarket: "SOL/USDC", supportedMetrics: ["PRICE", "FUNDING", "PNL"] },
    };
  }

  async createGhost(userId: string, input: unknown) {
    const draft = ghostDraftSchema.parse(input);
    const portfolio = await this.activePortfolio(this.database, userId);
    const frame = await this.latestFrame(this.database, portfolio.id);
    if (!frame) throw new AppError("FRAME_NOT_FOUND", "Market frame is not ready.", 503);
    const evaluations = evaluateGhost(draft.conditions, frame);
    const id = randomUUID();
    const timestamp = now();
    const expiresAt = new Date(Date.now() + draft.expiresInHours * 60 * 60 * 1000).toISOString();
    await this.database.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO ghosts
          (id, user_id, portfolio_id, name, side, amount_decimal, amount_type, max_slippage_bps, expires_at, conditions, evaluations, status, trigger_proximity, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT', $12, $13, $13)`,
        [
          id,
          userId,
          portfolio.id,
          draft.name,
          draft.side,
          draft.amount,
          draft.amountType,
          draft.maxSlippageBps,
          expiresAt,
          JSON.stringify(draft.conditions),
          JSON.stringify(evaluations),
          evaluations.filter((evaluation) => evaluation.satisfied).length / evaluations.length,
          timestamp,
        ],
      );
      await this.addActivity(tx, userId, id, "CREATED", `${draft.name} created as a draft.`, { side: draft.side });
    });
    return this.ghost(userId, id);
  }

  async ghost(userId: string, ghostId: string) {
    const ghost = await one<GhostRow>(this.database, "SELECT * FROM ghosts WHERE id = $1 AND user_id = $2", [ghostId, userId]);
    if (!ghost) throw new AppError("GHOST_NOT_FOUND", "Trigger was not found.", 404);
    const activities = await rows<Record<string, unknown>>(
      this.database,
      "SELECT id, type, message, metadata, created_at FROM ghost_activities WHERE ghost_id = $1 AND user_id = $2 ORDER BY created_at DESC",
      [ghostId, userId],
    );
    const execution = await one<Record<string, unknown>>(
      this.database,
      "SELECT * FROM executions WHERE ghost_id = $1 ORDER BY completed_at DESC LIMIT 1",
      [ghostId],
    );
    const reservation = ghost.reservation_id
      ? await one<ReservationRow>(this.database, "SELECT * FROM capital_reservations WHERE id = $1", [ghost.reservation_id])
      : null;
    return {
      ...publicGhost(ghost),
      reservation: reservation
        ? { id: reservation.id, asset: reservation.asset, amount: reservation.amount_decimal, status: reservation.status }
        : null,
      activities: activities.map((activity) => ({
        ...activity,
        metadata: parseJson(activity.metadata as JsonValue),
        created_at: new Date(activity.created_at as string).toISOString(),
      })),
      execution: execution ? { ...execution, receipt: parseJson(execution.receipt as JsonValue) } : null,
    };
  }

  private async availableAsset(db: Queryable, portfolioId: string, asset: string): Promise<Decimal> {
    const row = await one<Record<string, unknown>>(
      db,
      `SELECT b.quantity_decimal::text AS quantity,
        COALESCE(SUM(r.amount_decimal) FILTER (WHERE r.status IN ('ACTIVE', 'LOCKED')), 0)::text AS reserved
       FROM balances b
       LEFT JOIN capital_reservations r ON r.portfolio_id = b.portfolio_id AND r.asset = b.asset
       WHERE b.portfolio_id = $1 AND b.asset = $2
       GROUP BY b.quantity_decimal`,
      [portfolioId, asset],
    );
    if (!row) throw new AppError("BALANCE_NOT_FOUND", `${asset} balance was not found.`, 404);
    return new Decimal(row.quantity as string).minus(row.reserved as string);
  }

  async armGhost(userId: string, ghostId: string, idempotencyKey: string) {
    await this.database.transaction(async (tx) => {
      const replay = await one<Record<string, unknown>>(tx, "SELECT resource_id FROM idempotency_records WHERE user_id = $1 AND operation = 'ARM_GHOST' AND idempotency_key = $2", [userId, idempotencyKey]);
      if (replay) return;
      const portfolio = await this.activePortfolio(tx, userId);
      if (portfolio.data_mode !== "DEMO") {
        throw new AppError("LIVE_MONITORING_ONLY", "Switch to Demo Feed to start an executable trigger.", 409);
      }
      const ghost = await one<GhostRow>(tx, "SELECT * FROM ghosts WHERE id = $1 AND user_id = $2", [ghostId, userId]);
      if (!ghost) throw new AppError("GHOST_NOT_FOUND", "Trigger was not found.", 404);
      if (ghost.status !== "DRAFT") throw new AppError("INVALID_STATE", "Only a draft trigger can be started.", 409);
      if (new Date(ghost.expires_at).getTime() <= Date.now()) throw new AppError("GHOST_EXPIRED", "This trigger has expired.", 409);

      const asset = ghost.side === "BUY" ? "USDC" : "SOL";
      const available = await this.availableAsset(tx, portfolio.id, asset);
      const amount =
        ghost.side === "BUY"
          ? new Decimal(ghost.amount_decimal)
          : new Decimal((await this.balance(tx, portfolio.id, "SOL")).quantity_decimal)
              .mul(ghost.amount_decimal)
              .div(100)
              .toDecimalPlaces(9, Decimal.ROUND_DOWN);
      if (amount.lte(0) || amount.gt(available)) {
        throw new AppError("INSUFFICIENT_AVAILABLE_BALANCE", `Only ${available.toFixed()} ${asset} is available.`, 409);
      }

      const reservationId = randomUUID();
      const timestamp = now();
      await tx.query(
        "INSERT INTO capital_reservations (id, portfolio_id, ghost_id, asset, amount_decimal, status, version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 1, $6, $6)",
        [reservationId, portfolio.id, ghost.id, asset, amount.toFixed(), timestamp],
      );
      await tx.query(
        "INSERT INTO capital_reservation_events (id, reservation_id, from_status, to_status, reason, idempotency_key, created_at) VALUES ($1, $2, NULL, 'ACTIVE', 'GHOST_ARMED', $3, $4)",
        [randomUUID(), reservationId, `reservation:${reservationId}:active`, timestamp],
      );
      await tx.query(
        "UPDATE ghosts SET status = 'WATCHING', reservation_id = $1, armed_at = $2, updated_at = $2, was_qualified = FALSE WHERE id = $3",
        [reservationId, timestamp, ghost.id],
      );
      await this.addActivity(tx, userId, ghost.id, "ARMED", `${amount.toFixed()} ${asset} reserved.`, {
        reservationId,
        asset,
        amount: amount.toFixed(),
      });
      await this.addActivity(tx, userId, ghost.id, "WATCHING", "Trigger is evaluating complete Demo Feed frames.", {});
      await tx.query(
        "INSERT INTO idempotency_records (user_id, operation, idempotency_key, resource_id, created_at) VALUES ($1, 'ARM_GHOST', $2, $3, NOW())",
        [userId, idempotencyKey, ghost.id],
      );

      // Arming establishes the boundary. Evaluate only a newly stored frame so
      // a condition that was true before the user armed cannot execute retroactively.
      const nextStep = (portfolio.demo_step + 1) % DEMO_FRAMES.length;
      const frame = await this.createDemoFrame(tx, portfolio, nextStep);
      await tx.query("UPDATE portfolios SET demo_step = $1, updated_at = NOW() WHERE id = $2", [nextStep, portfolio.id]);
      await this.evaluateWatchingGhosts(tx, userId, { ...portfolio, demo_step: nextStep }, frame);
    });
    return this.ghost(userId, ghostId);
  }

  private async balance(db: Queryable, portfolioId: string, asset: string): Promise<BalanceRow> {
    const balance = await one<BalanceRow>(
      db,
      "SELECT asset, quantity_decimal::text, cost_basis_usdc_decimal::text FROM balances WHERE portfolio_id = $1 AND asset = $2",
      [portfolioId, asset],
    );
    if (!balance) throw new AppError("BALANCE_NOT_FOUND", `${asset} balance was not found.`, 404);
    return balance;
  }

  async pauseGhost(userId: string, ghostId: string) {
    const updated = await this.database.query(
      "UPDATE ghosts SET status = 'PAUSED', pause_reason = 'USER', updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'WATCHING' RETURNING id",
      [ghostId, userId],
    );
    if (!updated.rows[0]) throw new AppError("INVALID_STATE", "Only a watching trigger can be paused.", 409);
    await this.addActivity(this.database, userId, ghostId, "PAUSED", "Paused by user. Reserved capital remains armed.");
    return this.ghost(userId, ghostId);
  }

  async resumeGhost(userId: string, ghostId: string) {
    const portfolio = await this.activePortfolio(this.database, userId);
    if (portfolio.data_mode !== "DEMO") throw new AppError("LIVE_MONITORING_ONLY", "Switch to Demo Feed before resuming.", 409);
    const updated = await this.database.query(
      "UPDATE ghosts SET status = 'WATCHING', pause_reason = NULL, was_qualified = FALSE, updated_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'PAUSED' RETURNING id",
      [ghostId, userId],
    );
    if (!updated.rows[0]) throw new AppError("INVALID_STATE", "Only a paused trigger can be resumed.", 409);
    await this.addActivity(this.database, userId, ghostId, "RESUMED", "Trigger resumed and awaits a fresh frame.");
    return this.ghost(userId, ghostId);
  }

  async cancelGhost(userId: string, ghostId: string, idempotencyKey: string) {
    await this.database.transaction(async (tx) => {
      const replay = await one<Record<string, unknown>>(tx, "SELECT resource_id FROM idempotency_records WHERE user_id = $1 AND operation = 'CANCEL_GHOST' AND idempotency_key = $2", [userId, idempotencyKey]);
      if (replay) return;
      const ghost = await one<GhostRow>(tx, "SELECT * FROM ghosts WHERE id = $1 AND user_id = $2", [ghostId, userId]);
      if (!ghost) throw new AppError("GHOST_NOT_FOUND", "Trigger was not found.", 404);
      if (!["DRAFT", "ARMED", "WATCHING", "PAUSED"].includes(ghost.status)) {
        throw new AppError("INVALID_STATE", "This trigger cannot be cancelled now.", 409);
      }
      const timestamp = now();
      if (ghost.reservation_id) {
        const reservation = await one<ReservationRow>(tx, "SELECT * FROM capital_reservations WHERE id = $1", [ghost.reservation_id]);
        if (reservation && ["ACTIVE", "LOCKED"].includes(reservation.status)) {
          await tx.query("UPDATE capital_reservations SET status = 'RELEASED', version = version + 1, updated_at = $1 WHERE id = $2", [timestamp, reservation.id]);
          await tx.query(
            "INSERT INTO capital_reservation_events (id, reservation_id, from_status, to_status, reason, idempotency_key, created_at) VALUES ($1, $2, $3, 'RELEASED', 'GHOST_CANCELLED', $4, $5)",
            [randomUUID(), reservation.id, reservation.status, `reservation:${reservation.id}:cancelled`, timestamp],
          );
        }
      }
      await tx.query("UPDATE ghosts SET status = 'CANCELLED', cancelled_at = $1, updated_at = $1 WHERE id = $2", [timestamp, ghost.id]);
      await this.addActivity(tx, userId, ghost.id, "CANCELLED", "Trigger cancelled. Reserved capital released.");
      await tx.query(
        "INSERT INTO idempotency_records (user_id, operation, idempotency_key, resource_id, created_at) VALUES ($1, 'CANCEL_GHOST', $2, $3, NOW())",
        [userId, idempotencyKey, ghost.id],
      );
    });
    return this.ghost(userId, ghostId);
  }

  async setDataMode(userId: string, mode: DataMode) {
    await this.database.transaction(async (tx) => {
      const portfolio = await this.activePortfolio(tx, userId);
      await tx.query("UPDATE portfolios SET data_mode = $1, version = version + 1, updated_at = NOW() WHERE id = $2", [mode, portfolio.id]);
      if (mode === "LIVE") {
        const active = await rows<{ id: string }>(tx, "SELECT id FROM ghosts WHERE user_id = $1 AND status = 'WATCHING'", [userId]);
        await tx.query("UPDATE ghosts SET status = 'PAUSED', pause_reason = 'LIVE_MONITORING_ONLY', updated_at = NOW() WHERE user_id = $1 AND status = 'WATCHING'", [userId]);
        for (const ghost of active) {
          await this.addActivity(tx, userId, ghost.id, "PAUSED", "Live Data is monitoring-only; execution paused.");
        }
      } else {
        const paused = await rows<{ id: string }>(tx, "SELECT id FROM ghosts WHERE user_id = $1 AND status = 'PAUSED' AND pause_reason = 'LIVE_MONITORING_ONLY'", [userId]);
        await tx.query("UPDATE ghosts SET status = 'WATCHING', pause_reason = NULL, was_qualified = FALSE, updated_at = NOW() WHERE user_id = $1 AND status = 'PAUSED' AND pause_reason = 'LIVE_MONITORING_ONLY'", [userId]);
        for (const ghost of paused) {
          await this.addActivity(tx, userId, ghost.id, "RESUMED", "Demo Feed restored; trigger awaits a fresh frame.");
        }
      }
      await this.addActivity(tx, userId, null, "DATA_MODE_CHANGED", mode === "DEMO" ? "Demo Feed selected." : "Live Data selected in monitoring-only mode.", { mode });
    });
    return this.workspace(userId);
  }

  async advanceDemo(userId: string) {
    return this.database.transaction(async (tx) => {
      const portfolio = await this.activePortfolio(tx, userId);
      if (portfolio.data_mode !== "DEMO") throw new AppError("LIVE_MONITORING_ONLY", "Demo Feed controls are unavailable in Live mode.", 409);
      const nextStep = (portfolio.demo_step + 1) % DEMO_FRAMES.length;
      const frame = await this.createDemoFrame(tx, portfolio, nextStep);
      await tx.query("UPDATE portfolios SET demo_step = $1, updated_at = NOW() WHERE id = $2", [nextStep, portfolio.id]);
      await this.evaluateWatchingGhosts(tx, userId, portfolio, frame);
      return frame;
    });
  }

  async processEvaluationFrame(userId: string, frame: EvaluationFrame): Promise<void> {
    await this.database.transaction(async (tx) => {
      const portfolio = await this.activePortfolio(tx, userId);
      await this.evaluateWatchingGhosts(tx, userId, portfolio, frame);
    });
  }

  async replay(userId: string, input: unknown) {
    const request = input as { period?: string; draft?: unknown };
    if (!request || !["24H", "7D", "30D"].includes(request.period ?? "")) {
      throw new AppError("INVALID_REPLAY_PERIOD", "Choose a 24H, 7D, or 30D Replay period.", 422);
    }
    const period = request.period as "24H" | "7D" | "30D";
    const draft = ghostDraftSchema.parse(request.draft);
    const portfolio = await this.activePortfolio(this.database, userId);
    const sol = await this.balance(this.database, portfolio.id, "SOL");
    const periodConfig = {
      "24H": { points: 24, intervalHours: 1 },
      "7D": { points: 42, intervalHours: 4 },
      "30D": { points: 60, intervalHours: 12 },
    }[period];
    const endAt = Date.now();
    const frames: EvaluationFrame[] = Array.from({ length: periodConfig.points }, (_, index) => {
      const sample = DEMO_FRAMES[index % DEMO_FRAMES.length] ?? DEMO_FRAMES[0];
      const timestamp = new Date(endAt - (periodConfig.points - index - 1) * periodConfig.intervalHours * 3_600_000).toISOString();
      const priceId = randomUUID();
      const fundingId = randomUUID();
      const pnlId = randomUUID();
      return {
        id: randomUUID(),
        market: "SOL/USDC",
        cutoffAt: timestamp,
        assembledAt: timestamp,
        mode: "DEMO",
        completeness: "COMPLETE",
        executionEligible: false,
        observations: {
          PRICE: { id: priceId, metric: "PRICE", value: sample.price, unit: "USDC_PER_SOL", provider: "ghost-replay-fixture-v1", providerSequence: index + 1, sourceTimestamp: timestamp, receivedAt: timestamp, provenance: "DEMO" },
          FUNDING: { id: fundingId, metric: "FUNDING", value: sample.funding, unit: "RATIO", provider: "ghost-replay-fixture-v1", providerSequence: index + 1, sourceTimestamp: timestamp, receivedAt: timestamp, provenance: "DEMO" },
          PNL: { id: pnlId, metric: "PNL", value: calculatePnlRatio(sol.quantity_decimal, sol.cost_basis_usdc_decimal ?? "0", sample.price), unit: "RATIO", provider: "ghost-replay-ledger-v1", providerSequence: index + 1, sourceTimestamp: timestamp, receivedAt: timestamp, provenance: "DEMO", portfolioVersion: portfolio.version, derivedFromObservationIds: [priceId] },
        },
      };
    });
    const evaluation = evaluateReplay(draft.conditions, frames);
    const triggers = evaluation.points.filter((point) => point.triggered);
    const firstTrigger = triggers[0] ?? null;
    const latestTrigger = triggers.at(-1) ?? null;
    const triggerIndexes = triggers.map((trigger) => evaluation.points.indexOf(trigger));
    const intervals = triggerIndexes.map((value, index) => index === 0 ? value + 1 : value - triggerIndexes[index - 1]!);
    const sortedIntervals = [...intervals].sort((a, b) => a - b);
    const medianIntervals = sortedIntervals.length ? sortedIntervals[Math.floor(sortedIntervals.length / 2)]! : 0;
    const firstPrice = firstTrigger ? new Decimal(firstTrigger.frame.observations.PRICE.value) : null;
    const finalPrice = new Decimal(frames.at(-1)!.observations.PRICE.value);
    const outcome = firstPrice ? (draft.side === "BUY" ? finalPrice.minus(firstPrice) : firstPrice.minus(finalPrice)).div(firstPrice).mul(100) : new Decimal(0);
    const summary = {
      period,
      triggerCount: triggers.length,
      firstTriggerAt: firstTrigger?.frame.cutoffAt ?? null,
      latestTriggerAt: latestTrigger?.frame.cutoffAt ?? null,
      medianWatchingHours: medianIntervals * periodConfig.intervalHours,
      simulatedOutcomePercent: outcome.toDecimalPlaces(2).toFixed(),
      frameCount: frames.length,
      completeFrameCount: frames.length,
    };
    const id = randomUUID();
    const publicPoints = evaluation.points.map((point) => ({
      frameId: point.frame.id,
      at: point.frame.cutoffAt,
      readyCount: point.readyCount,
      triggered: point.triggered,
      values: Object.fromEntries(Object.entries(point.frame.observations).map(([metric, observation]) => [metric, observation.value])),
      evaluations: point.evaluations,
    }));
    await this.database.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO backtests (id, user_id, portfolio_id, period, provider, status, draft, summary, points, created_at) VALUES ($1, $2, $3, $4, 'ghost-replay-fixture-v1', 'COMPLETE', $5, $6, $7, NOW())",
        [id, userId, portfolio.id, period, JSON.stringify(draft), JSON.stringify(summary), JSON.stringify(publicPoints)],
      );
      for (const trigger of triggers) {
        await tx.query(
          "INSERT INTO backtest_triggers (id, backtest_id, frame_id, triggered_at, values) VALUES ($1, $2, $3, $4, $5)",
          [randomUUID(), id, trigger.frame.id, trigger.frame.cutoffAt, JSON.stringify(Object.fromEntries(Object.entries(trigger.frame.observations).map(([metric, observation]) => [metric, observation.value])))],
        );
      }
      await this.addActivity(tx, userId, null, "REPLAY_COMPLETED", `${period} historical simulation completed with ${triggers.length} trigger${triggers.length === 1 ? "" : "s"}.`, { backtestId: id, period });
    });
    return {
      id,
      period,
      status: "COMPLETE",
      label: "Historical simulation",
      provider: { name: "Triggerlane deterministic history", mode: "HISTORICAL", provenance: "DEMO", completeMetrics: ["PRICE", "FUNDING", "PNL"], liveHistory: false },
      disclaimer: "Historical simulations do not predict future performance.",
      summary,
      points: publicPoints,
    };
  }

  async strategies() {
    await this.database.transaction(async (tx) => {
      for (const [index, strategy] of STRATEGY_TEMPLATES.entries()) {
        await tx.query(
          `INSERT INTO strategy_templates (id, name, category, description, thesis, featured, metrics, draft, is_active, sort_order, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, NOW())
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, description = EXCLUDED.description, thesis = EXCLUDED.thesis, featured = EXCLUDED.featured, metrics = EXCLUDED.metrics, draft = EXCLUDED.draft, is_active = TRUE, sort_order = EXCLUDED.sort_order, updated_at = NOW()`,
          [strategy.id, strategy.name, strategy.category, strategy.description, strategy.thesis, strategy.featured, JSON.stringify(strategy.metrics), JSON.stringify(strategy.draft), index],
        );
      }
    });
    const templates = await rows<Record<string, unknown>>(
      this.database,
      "SELECT id, name, category, description, thesis, featured, metrics, draft FROM strategy_templates WHERE is_active = TRUE ORDER BY sort_order",
    );
    return {
      title: "Triggerlane Strategies",
      categories: ["Popular", "Accumulation", "Profit Taking", "Protection", "Advanced"],
      capabilities: { market: "SOL/USDC", metrics: ["PRICE", "FUNDING", "PNL"], unsupportedAdvancedMetrics: ["LIQUIDITY", "TVL", "VOLUME"] },
      strategies: templates.map((template) => ({ ...template, metrics: parseJson(template.metrics as JsonValue), draft: parseJson(template.draft as JsonValue) })),
    };
  }

  async useStrategy(userId: string, strategyId: string) {
    const strategy = STRATEGY_TEMPLATES.find((item) => item.id === strategyId);
    if (!strategy) throw new AppError("STRATEGY_NOT_FOUND", "Strategy was not found.", 404);
    await this.addActivity(this.database, userId, null, "STRATEGY_USED", `${strategy.name} loaded into Composer.`, { strategyId });
    return strategy;
  }

  private async evaluateWatchingGhosts(db: Queryable, userId: string, portfolio: PortfolioRow, frame: EvaluationFrame): Promise<void> {
    if (frame.completeness !== "COMPLETE" || !frame.executionEligible) {
      const pauseReason = frame.completeness === "STALE" ? "DATA_STALE" : "FRAME_INCOMPLETE";
      const active = await rows<{ id: string }>(db, "SELECT id FROM ghosts WHERE user_id = $1 AND status = 'WATCHING'", [userId]);
      await db.query(
        "UPDATE ghosts SET status = 'PAUSED', pause_reason = $1, updated_at = NOW() WHERE user_id = $2 AND status = 'WATCHING'",
        [pauseReason, userId],
      );
      for (const ghost of active) {
        await this.addActivity(db, userId, ghost.id, "PAUSED", pauseReason === "DATA_STALE" ? "Required market data became stale. Execution is blocked." : "A complete aligned market frame could not be assembled. Execution is blocked.", { frameId: frame.id, pauseReason });
      }
      return;
    }

    const recovering = await rows<{ id: string }>(
      db,
      "SELECT id FROM ghosts WHERE user_id = $1 AND status = 'PAUSED' AND pause_reason IN ('DATA_STALE', 'FRAME_INCOMPLETE')",
      [userId],
    );
    await db.query(
      "UPDATE ghosts SET status = 'WATCHING', pause_reason = NULL, was_qualified = FALSE, updated_at = NOW() WHERE user_id = $1 AND status = 'PAUSED' AND pause_reason IN ('DATA_STALE', 'FRAME_INCOMPLETE')",
      [userId],
    );
    for (const ghost of recovering) {
      await this.addActivity(db, userId, ghost.id, "DATA_RECOVERED", "A complete fresh frame restored automatic monitoring.", { frameId: frame.id });
    }

    const ghostRows = await rows<GhostRow>(db, "SELECT * FROM ghosts WHERE user_id = $1 AND status = 'WATCHING' ORDER BY created_at", [userId]);
    for (const ghost of ghostRows) {
      if (new Date(ghost.expires_at).getTime() <= Date.now()) {
        await db.query("UPDATE ghosts SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1", [ghost.id]);
        if (ghost.reservation_id) await this.releaseReservation(db, ghost.reservation_id, "GHOST_EXPIRED");
        await this.addActivity(db, userId, ghost.id, "EXPIRED", "Trigger expired. Reserved capital released.");
        continue;
      }
      const evaluations = evaluateGhost(parseJson(ghost.conditions), frame);
      const readyCount = evaluations.filter((evaluation) => evaluation.satisfied).length;
      const allQualified = readyCount === evaluations.length;
      await db.query(
        "UPDATE ghosts SET evaluations = $1, trigger_proximity = $2, was_qualified = $3, updated_at = NOW() WHERE id = $4",
        [JSON.stringify(evaluations), readyCount / evaluations.length, allQualified, ghost.id],
      );
      if (allQualified && !ghost.was_qualified) {
        await this.executeGhost(db, userId, portfolio, ghost, frame, evaluations);
      }
    }
  }

  private async releaseReservation(db: Queryable, reservationId: string, reason: string): Promise<void> {
    const reservation = await one<ReservationRow>(db, "SELECT * FROM capital_reservations WHERE id = $1", [reservationId]);
    if (!reservation || !["ACTIVE", "LOCKED"].includes(reservation.status)) return;
    const timestamp = now();
    await db.query("UPDATE capital_reservations SET status = 'RELEASED', version = version + 1, updated_at = $1 WHERE id = $2", [timestamp, reservation.id]);
    await db.query(
      "INSERT INTO capital_reservation_events (id, reservation_id, from_status, to_status, reason, idempotency_key, created_at) VALUES ($1, $2, $3, 'RELEASED', $4, $5, $6) ON CONFLICT (idempotency_key) DO NOTHING",
      [randomUUID(), reservation.id, reservation.status, reason, `reservation:${reservation.id}:${reason.toLowerCase()}`, timestamp],
    );
  }

  private async executeGhost(
    db: Queryable,
    userId: string,
    portfolio: PortfolioRow,
    ghost: GhostRow,
    frame: EvaluationFrame,
    evaluations: ConditionResult[],
  ): Promise<void> {
    if (!frame.executionEligible || !ghost.reservation_id) return;
    const attemptKey = `attempt:${ghost.id}:${ghost.configuration_version}:${frame.id}`;
    const existing = await one<Record<string, unknown>>(db, "SELECT id FROM execution_attempts WHERE idempotency_key = $1", [attemptKey]);
    if (existing) return;
    const reservation = await one<ReservationRow>(db, "SELECT * FROM capital_reservations WHERE id = $1 AND status = 'ACTIVE'", [ghost.reservation_id]);
    if (!reservation) throw new AppError("RESERVATION_NOT_ACTIVE", "Capital reservation is not active.", 409);

    const attemptId = randomUUID();
    const timestamp = now();
    await db.query(
      "INSERT INTO execution_attempts (id, ghost_id, configuration_version, trigger_frame_id, idempotency_key, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'LOCKED', $6, $6)",
      [attemptId, ghost.id, ghost.configuration_version, frame.id, attemptKey, timestamp],
    );
    await db.query("UPDATE capital_reservations SET status = 'LOCKED', version = version + 1, updated_at = $1 WHERE id = $2", [timestamp, reservation.id]);
    await db.query("UPDATE ghosts SET status = 'TRIGGERED', triggered_at = $1, updated_at = $1 WHERE id = $2", [timestamp, ghost.id]);
    await this.addActivity(db, userId, ghost.id, "TRIGGERED", `All ${evaluations.length === 1 ? "active condition" : `${evaluations.length} active conditions`} locked in one complete frame.`, { frameId: frame.id });

    const price = frame.observations.PRICE.value;
    const quote = buildSandboxQuote({ side: ghost.side, reservedAmount: reservation.amount_decimal, referencePrice: price });
    if (quote.modeledSlippageBps > ghost.max_slippage_bps) {
      await db.query("UPDATE execution_attempts SET status = 'BLOCKED', updated_at = NOW() WHERE id = $1", [attemptId]);
      await db.query("UPDATE capital_reservations SET status = 'ACTIVE', version = version + 1, updated_at = NOW() WHERE id = $1", [reservation.id]);
      await db.query("UPDATE ghosts SET status = 'WATCHING', was_qualified = TRUE, updated_at = NOW() WHERE id = $1", [ghost.id]);
      await this.addActivity(db, userId, ghost.id, "EXECUTION_BLOCKED", `Modeled slippage ${quote.modeledSlippageBps} bps exceeded the configured limit.`, { quote });
      return;
    }

    await db.query("UPDATE execution_attempts SET status = 'SETTLING', updated_at = NOW() WHERE id = $1", [attemptId]);
    await db.query("UPDATE ghosts SET status = 'EXECUTING', updated_at = NOW() WHERE id = $1", [ghost.id]);
    await this.addActivity(db, userId, ghost.id, "EXECUTION_STARTED", "Simulated settlement started.", { quote });

    const executionId = randomUUID();
    const ledgerTransactionId = randomUUID();
    const solBalance = await this.balance(db, portfolio.id, "SOL");
    const usdcBalance = await this.balance(db, portfolio.id, "USDC");
    const solQuantity = new Decimal(solBalance.quantity_decimal);
    const solBasis = new Decimal(solBalance.cost_basis_usdc_decimal ?? 0);
    let inputAsset: "SOL" | "USDC";
    let outputAsset: "SOL" | "USDC";
    let solDelta: Decimal;
    let usdcDelta: Decimal;
    let costBasisDelta: Decimal;

    if (ghost.side === "SELL") {
      inputAsset = "SOL";
      outputAsset = "USDC";
      solDelta = new Decimal(reservation.amount_decimal).negated();
      usdcDelta = new Decimal(quote.amountOut);
      costBasisDelta = solQuantity.eq(0) ? new Decimal(0) : solBasis.mul(solDelta.abs()).div(solQuantity).negated();
    } else {
      inputAsset = "USDC";
      outputAsset = "SOL";
      solDelta = new Decimal(quote.amountOut);
      usdcDelta = new Decimal(reservation.amount_decimal).negated();
      costBasisDelta = new Decimal(reservation.amount_decimal);
    }

    const newSolQuantity = solQuantity.plus(solDelta);
    const newSolBasis = Decimal.max(0, solBasis.plus(costBasisDelta));
    const newUsdcQuantity = new Decimal(usdcBalance.quantity_decimal).plus(usdcDelta);
    if (newSolQuantity.lt(0) || newUsdcQuantity.lt(0)) throw new AppError("NEGATIVE_BALANCE", "Settlement would create a negative balance.", 500);

    const completedAt = now();
    await db.query(
      "INSERT INTO ledger_transactions (id, portfolio_id, type, execution_id, idempotency_key, created_at) VALUES ($1, $2, 'TRADE', $3, $4, $5)",
      [ledgerTransactionId, portfolio.id, executionId, `settlement:${ghost.id}`, completedAt],
    );
    await db.query(
      "INSERT INTO ledger_entries (id, transaction_id, portfolio_id, asset, amount_decimal, cost_basis_delta_usdc_decimal, unit_price_usdc_decimal, type, created_at) VALUES ($1, $2, $3, 'SOL', $4, $5, $6, $7, $8), ($9, $2, $3, 'USDC', $10, NULL, 1, $11, $8)",
      [
        randomUUID(),
        ledgerTransactionId,
        portfolio.id,
        solDelta.toFixed(),
        costBasisDelta.toFixed(6),
        quote.executionPrice,
        solDelta.isNegative() ? "TRADE_DEBIT" : "TRADE_CREDIT",
        completedAt,
        randomUUID(),
        usdcDelta.toFixed(6),
        usdcDelta.isNegative() ? "TRADE_DEBIT" : "TRADE_CREDIT",
      ],
    );
    await db.query(
      "UPDATE balances SET quantity_decimal = $1, cost_basis_usdc_decimal = $2, version = version + 1, updated_at = $3 WHERE portfolio_id = $4 AND asset = 'SOL'",
      [newSolQuantity.toFixed(9), newSolBasis.toFixed(6), completedAt, portfolio.id],
    );
    await db.query(
      "UPDATE balances SET quantity_decimal = $1, version = version + 1, updated_at = $2 WHERE portfolio_id = $3 AND asset = 'USDC'",
      [newUsdcQuantity.toFixed(6), completedAt, portfolio.id],
    );
    await db.query("UPDATE portfolios SET version = version + 1, updated_at = $1 WHERE id = $2", [completedAt, portfolio.id]);

    const receipt = {
      executionId,
      ghost: { id: ghost.id, name: ghost.name, configurationVersion: ghost.configuration_version },
      frame: {
        id: frame.id,
        cutoffAt: frame.cutoffAt,
        completeness: frame.completeness,
        observations: frame.observations,
      },
      evaluations,
      reservation: { id: reservation.id, asset: reservation.asset, amount: reservation.amount_decimal },
      quote,
      ledgerTransactionId,
      settledAt: completedAt,
      executionMode: "SIMULATED",
    };
    await db.query(
      `INSERT INTO executions
        (id, ghost_id, portfolio_id, attempt_id, status, input_asset, input_amount, output_asset, output_amount, trigger_price, execution_price, modeled_slippage_bps, quote_model_version, idempotency_key, trigger_frame_id, settlement_frame_id, reservation_id, receipt, started_at, completed_at)
       VALUES ($1, $2, $3, $4, 'FILLED', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14, $15, $16, $17, $18)`,
      [
        executionId,
        ghost.id,
        portfolio.id,
        attemptId,
        inputAsset,
        reservation.amount_decimal,
        outputAsset,
        quote.amountOut,
        quote.referencePrice,
        quote.executionPrice,
        quote.modeledSlippageBps,
        quote.modelVersion,
        `execution:${ghost.id}`,
        frame.id,
        reservation.id,
        JSON.stringify(receipt),
        timestamp,
        completedAt,
      ],
    );
    await db.query("UPDATE execution_attempts SET status = 'FILLED', updated_at = $1 WHERE id = $2", [completedAt, attemptId]);
    await db.query("UPDATE capital_reservations SET status = 'CONSUMED', version = version + 1, updated_at = $1 WHERE id = $2", [completedAt, reservation.id]);
    await db.query(
      "INSERT INTO capital_reservation_events (id, reservation_id, from_status, to_status, reason, idempotency_key, created_at) VALUES ($1, $2, 'LOCKED', 'CONSUMED', 'SETTLEMENT_FILLED', $3, $4)",
      [randomUUID(), reservation.id, `reservation:${reservation.id}:consumed`, completedAt],
    );
    await db.query("UPDATE ghosts SET status = 'FILLED', executed_at = $1, updated_at = $1 WHERE id = $2", [completedAt, ghost.id]);
    await this.addActivity(db, userId, ghost.id, "FILLED", `${new Decimal(reservation.amount_decimal).toDecimalPlaces(9).toFixed()} ${inputAsset} settled for ${new Decimal(quote.amountOut).toDecimalPlaces(6).toFixed()} ${outputAsset}.`, {
      executionId,
      ledgerTransactionId,
    });
  }

  async liveMarket(): Promise<Record<string, unknown>> {
    const receivedAt = now();
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new AppError("LIVE_PROVIDER_ERROR", "Hyperliquid Live Data is unavailable.", 503);
    const payload = (await response.json()) as [
      { universe: Array<{ name: string }> },
      Array<{ markPx: string; oraclePx: string; midPx?: string; funding: string }>,
    ];
    const index = payload[0].universe.findIndex((asset) => asset.name === "SOL");
    if (index < 0 || !payload[1][index]) throw new AppError("LIVE_MARKET_NOT_FOUND", "SOL was not found in the provider payload.", 503);
    const context = payload[1][index];
    return {
      market: "SOL/USDC",
      provider: "Hyperliquid",
      price: context.markPx,
      oraclePrice: context.oraclePx,
      midPrice: context.midPx ?? null,
      funding: context.funding,
      receivedAt,
      sourceTimestamp: null,
      executionEligible: false,
      eligibilityReason: "The provider envelope has no documented source timestamp.",
    };
  }
}
