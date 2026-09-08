import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { PGlite } from "@electric-sql/pglite";
import { getDatabase } from "./db.js";
import { AppError, GhostService } from "./service.js";
import { runtimeConfig } from "./config.js";

const COOKIE_NAME = "ghost_session";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    sessionToken?: string;
  }
}

export async function buildServer(database?: PGlite, limitOverrides: Partial<ReturnType<typeof runtimeConfig>["limits"]> = {}): Promise<FastifyInstance> {
  if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
    throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
  }
  const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0 || trustedProxyHops > 2) {
    throw new Error("TRUST_PROXY_HOPS must be 0, 1, or 2.");
  }
  const trustProxy = trustedProxyHops > 0 ? (_address: string, hop: number) => hop < trustedProxyHops : false;
  const logger = process.env.NODE_ENV === "test" ? false : { redact: { paths: ["req.headers.cookie", "req.headers.authorization", "req.headers['idempotency-key']", "res.headers['set-cookie']"], censor: "[REDACTED]" } };
  const app = Fastify({ logger, trustProxy });
  const db = database ?? (await getDatabase());
  const service = new GhostService(db);
  const baseConfig = runtimeConfig();
  const config = { ...baseConfig, limits: { ...baseConfig.limits, ...limitOverrides } };
  const events = new EventEmitter();
  const workerId = randomUUID();
  const startedAt = Date.now();
  let requestCount = 0;
  let errorCount = 0;
  let totalResponseMs = 0;
  let workerErrorCount = 0;
  let lastWorkerErrorAt: string | null = null;
  const rateWindows = new Map<string, { count: number; resetsAt: number }>();
  const sseBySession = new Map<string, number>();
  let sseTotal = 0;
  events.setMaxListeners(200);

  await app.register(cookie, {
    secret: process.env.SESSION_SECRET ?? "ghost-orders-local-session-secret-change-me",
    hook: "onRequest",
  });
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173",
    credentials: true,
  });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.NODE_ENV === "production") reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  });

  async function requireOperationsAccess(request: FastifyRequest): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;
    const expected = process.env.OPERATIONS_TOKEN;
    if (!expected || expected.length < 32) throw new AppError("OPERATIONS_NOT_CONFIGURED", "Operational diagnostics are unavailable.", 404);
    if (request.headers.authorization !== `Bearer ${expected}`) throw new AppError("OPERATIONS_UNAUTHORIZED", "Operational diagnostics require authorization.", 401);
  }

  function consumeLimit(key: string, maximum: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
    const timestamp = Date.now();
    if (rateWindows.size > 10_000) {
      for (const [windowKey, windowValue] of rateWindows) if (windowValue.resetsAt <= timestamp) rateWindows.delete(windowKey);
    }
    const current = rateWindows.get(key);
    const window = !current || current.resetsAt <= timestamp ? { count: 0, resetsAt: timestamp + windowMs } : current;
    window.count += 1;
    rateWindows.set(key, window);
    return { allowed: window.count <= maximum, retryAfterSeconds: Math.max(1, Math.ceil((window.resetsAt - timestamp) / 1000)) };
  }

  function rejectLimited(reply: FastifyReply, retryAfterSeconds: number, code: string, message: string) {
    return reply.header("retry-after", retryAfterSeconds).status(429).send({ error: { code, message, retryAfterSeconds } });
  }

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    const ipLimit = consumeLimit(`ip:${request.ip}`, config.limits.requestsPerIpPerMinute, 60_000);
    if (!ipLimit.allowed) return rejectLimited(reply, ipLimit.retryAfterSeconds, "IP_RATE_LIMITED", "Too many requests from this network. Try again shortly.");
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS" || request.url === "/api/session/anonymous") return;
    const sessionKey = readSessionToken(request) ?? `unauthenticated:${request.ip}`;
    const mutationLimit = consumeLimit(`mutation:${sessionKey}`, config.limits.mutationsPerSessionPerMinute, 60_000);
    if (!mutationLimit.allowed) return rejectLimited(reply, mutationLimit.retryAfterSeconds, "SESSION_RATE_LIMITED", "Too many changes in this paper-trading session. Try again shortly.");
  });

  app.addHook("onResponse", async (request, reply) => {
    if (request.url === "/api/events") return;
    requestCount += 1;
    if (reply.statusCode >= 500) errorCount += 1;
    totalResponseMs += reply.elapsedTime;
  });

  function readSessionToken(request: FastifyRequest): string | undefined {
    const value = request.cookies[COOKIE_NAME];
    if (!value) return undefined;
    const unsigned = request.unsignCookie(value);
    return unsigned.valid ? unsigned.value : undefined;
  }

  async function requireSession(request: FastifyRequest): Promise<void> {
    const token = readSessionToken(request);
    const session = await service.resolveSession(token);
    if (!session || !token) throw new AppError("UNAUTHORIZED", "Start a paper-trading session first.", 401);
    request.userId = session.userId;
    request.sessionToken = token;
  }

  function changed(userId: string, type: string, payload: Record<string, unknown> = {}): void {
    events.emit(userId, { type, ...payload, at: new Date().toISOString() });
  }

  function requireIdempotencyKey(request: FastifyRequest): string {
    const value = request.headers["idempotency-key"];
    if (typeof value !== "string" || value.length < 8 || value.length > 128) {
      throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "This action requires a valid idempotency key.", 400);
    }
    return value;
  }

  let tickRunning = false;
  const backgroundTick = async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await service.runMaintenanceTick(workerId, (userId, event) => events.emit(userId, event));
    } finally {
      tickRunning = false;
    }
  };
  if (process.env.NODE_ENV !== "test") await backgroundTick();
  const workerTimer = process.env.NODE_ENV === "test" ? null : setInterval(() => void backgroundTick().catch((error) => {
    workerErrorCount += 1;
    lastWorkerErrorAt = new Date().toISOString();
    app.log.error({ err: error, workerErrorCount }, "maintenance worker tick failed");
  }), 1_000);
  workerTimer?.unref();
  app.addHook("onClose", async () => {
    if (workerTimer) clearInterval(workerTimer);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: { code: "VALIDATION_ERROR", message: "Check the highlighted trigger configuration.", issues: error.issues },
      });
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    app.log.error(error);
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Triggerlane could not complete that action." } });
  });

  app.get("/health", async () => ({ ok: true, service: "ghost-api", database: "pglite-postgres" }));
  app.get("/api/capabilities", async () => config);
  app.get("/health/ready", async (_request, reply) => {
    try {
      await db.query("SELECT 1 AS ready");
      return { ok: true, service: "ghost-api", database: "ready" };
    } catch {
      return reply.status(503).send({ ok: false, service: "ghost-api", database: "unavailable" });
    }
  });
  app.get("/health/diagnostics", { preHandler: requireOperationsAccess }, async () => {
    const [outbox, attempts, lease] = await Promise.all([
      db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM outbox_events WHERE published_at IS NULL"),
      db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM execution_attempts WHERE status IN ('LOCKED', 'SETTLING')"),
      db.query<{ owner_id: string; expires_at: string }>("SELECT owner_id, expires_at FROM worker_leases WHERE partition_key = 'SOL/USDC'"),
    ]);
    return {
      ok: true,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      requests: requestCount,
      serverErrors: errorCount,
      averageResponseMs: requestCount === 0 ? 0 : Number((totalResponseMs / requestCount).toFixed(2)),
      outboxPending: Number(outbox.rows[0]?.count ?? 0),
      executionAttemptsInFlight: Number(attempts.rows[0]?.count ?? 0),
      workerErrors: workerErrorCount,
      lastWorkerErrorAt,
      workerLease: lease.rows[0] ? { active: new Date(lease.rows[0].expires_at).getTime() > Date.now(), owner: lease.rows[0].owner_id.slice(0, 8) } : { active: false, owner: null },
    };
  });
  app.get("/health/integrity", { preHandler: requireOperationsAccess }, async () => service.integrityReport());
  app.get("/health/retention", { preHandler: requireOperationsAccess }, async () => {
    const cutoff = new Date(Date.now() - config.limits.anonymousRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    const candidateRows = await db.query<{ id: string }>(
      `SELECT user_id AS id FROM sessions
       GROUP BY user_id
       HAVING MAX(expires_at) <= NOW() AND MAX(last_seen_at) < $1
       ORDER BY MAX(last_seen_at) LIMIT 1000`,
      [cutoff],
    );
    const ids = candidateRows.rows.map((row) => row.id);
    const empty = { rows: [{ count: "0" }] };
    const [sessions, portfolios, ghosts] = ids.length ? await Promise.all([
      db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM sessions WHERE user_id=ANY($1::text[])", [ids]),
      db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM portfolios WHERE user_id=ANY($1::text[])", [ids]),
      db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM ghosts WHERE user_id=ANY($1::text[])", [ids]),
    ]) : [empty, empty, empty];
    return { dryRun: true, deletionEnabled: false, capped: ids.length === 1000, retentionDays: config.limits.anonymousRetentionDays, cutoff, candidates: { users: String(ids.length), sessions: sessions.rows[0]?.count ?? "0", portfolios: portfolios.rows[0]?.count ?? "0", ghosts: ghosts.rows[0]?.count ?? "0" } };
  });

  app.post("/api/session/anonymous", async (request, reply) => {
    const currentToken = readSessionToken(request);
    const current = await service.resolveSession(currentToken);
    if (current) return { userId: current.userId, expiresAt: current.expiresAt };
    const creationLimit = consumeLimit(`anonymous:${request.ip}`, config.limits.anonymousSessionsPerIpPerHour, 60 * 60_000);
    if (!creationLimit.allowed) return rejectLimited(reply, creationLimit.retryAfterSeconds, "SESSION_CREATION_LIMITED", "Too many new paper accounts were created from this network. Try again later.");
    const requestedMode = (request.body as { initialMode?: string } | undefined)?.initialMode;
    const session = await service.createAnonymousSession(requestedMode === "DEMO" ? "DEMO" : "LIVE");
    await service.trackAnalytics(session.userId, "sandbox_started", { environment: config.environment });
    reply.setCookie(COOKIE_NAME, session.token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      signed: true,
      maxAge: 30 * 24 * 60 * 60,
    });
    return { userId: session.userId, expiresAt: session.expiresAt };
  });

  app.get("/api/session", { preHandler: requireSession }, async (request) => ({ userId: request.userId }));

  app.delete("/api/session", { preHandler: requireSession }, async (request, reply) => {
    await service.deleteSession(request.sessionToken!);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/workspace", { preHandler: requireSession }, async (request) => service.workspace(request.userId!));
  app.get("/api/markets", { preHandler: requireSession }, async () => service.markets());
  app.get("/api/markets/:asset", { preHandler: requireSession }, async (request) => service.market((request.params as { asset: string }).asset));
  app.get("/api/market-view", { preHandler: requireSession }, async (request) => {
    const { interval } = request.query as { interval?: string };
    return service.marketView(request.userId!, interval);
  });
  app.get("/api/data-mode", { preHandler: requireSession }, async (request) => service.dataMode(request.userId!));
  app.get("/api/portfolio", { preHandler: requireSession }, async (request) => service.portfolio(request.userId!));
  app.post("/api/portfolio/reset", { preHandler: requireSession }, async (request) => {
    const workspace = await service.resetPortfolio(request.userId!, requireIdempotencyKey(request));
    changed(request.userId!, "portfolio.updated", { reason: "RESET" });
    return workspace;
  });
  app.get("/api/ghosts", { preHandler: requireSession }, async (request) => service.ghosts(request.userId!));
  app.get("/api/ghost-pages", { preHandler: requireSession }, async (request) => service.ghostPage(request.userId!, request.query));
  app.get("/api/ghosts/:id", { preHandler: requireSession }, async (request) => {
    const { id } = request.params as { id: string };
    return service.ghost(request.userId!, id);
  });
  app.patch("/api/ghosts/:id", { preHandler: requireSession }, async (request) => {
    const ghost = await service.updateGhost(request.userId!, (request.params as { id: string }).id, request.body);
    changed(request.userId!, "ghost.status.updated", { ghostId: ghost.id, status: ghost.status });
    return ghost;
  });
  app.get("/api/ghosts/:id/activity", { preHandler: requireSession }, async (request) => service.ghostActivity(request.userId!, (request.params as { id: string }).id, request.query));
  app.get("/api/history", { preHandler: requireSession }, async (request) => service.history(request.userId!));
  app.get("/api/history-pages", { preHandler: requireSession }, async (request) => service.historyPage(request.userId!, request.query));
  app.get("/api/ledger-pages", { preHandler: requireSession }, async (request) => service.ledgerPage(request.userId!, request.query));
  app.get("/api/executions/:id", { preHandler: requireSession }, async (request) => service.execution(request.userId!, (request.params as { id: string }).id));

  app.post("/api/ghosts", { preHandler: requireSession }, async (request, reply) => {
    const count = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM ghosts WHERE user_id=$1", [request.userId!]);
    if (Number(count.rows[0]?.count ?? 0) >= config.limits.triggersPerAccount) {
      return reply.status(429).send({ error: { code: "TRIGGER_QUOTA_REACHED", message: `This account can store up to ${config.limits.triggersPerAccount} triggers.` } });
    }
    const ghost = await service.createGhost(request.userId!, request.body);
    changed(request.userId!, "ghost.status.updated", { ghostId: ghost.id, status: ghost.status });
    return reply.status(201).send(ghost);
  });

  app.post("/api/ghosts/:id/arm", { preHandler: requireSession }, async (request) => {
    const { id } = request.params as { id: string };
    const ghost = await service.armGhost(request.userId!, id, requireIdempotencyKey(request));
    changed(request.userId!, "ghost.status.updated", { ghostId: ghost.id, status: ghost.status });
    changed(request.userId!, "market.frame.updated", { reason: "ghost.armed", ghostId: ghost.id });
    await service.trackAnalytics(request.userId!, "ghost_armed", { ghostId: ghost.id });
    return ghost;
  });

  app.post("/api/ghosts/:id/pause", { preHandler: requireSession }, async (request) => {
    const { id } = request.params as { id: string };
    const ghost = await service.pauseGhost(request.userId!, id);
    changed(request.userId!, "ghost.status.updated", { ghostId: ghost.id, status: ghost.status });
    await service.trackAnalytics(request.userId!, "ghost_paused", { ghostId: ghost.id });
    return ghost;
  });

  app.post("/api/ghosts/:id/resume", { preHandler: requireSession }, async (request) => {
    const { id } = request.params as { id: string };
    const ghost = await service.resumeGhost(request.userId!, id);
    changed(request.userId!, "ghost.status.updated", { ghostId: ghost.id, status: ghost.status });
    return ghost;
  });

  app.post("/api/ghosts/:id/cancel", { preHandler: requireSession }, async (request) => {
    const { id } = request.params as { id: string };
    const ghost = await service.cancelGhost(request.userId!, id, requireIdempotencyKey(request));
    changed(request.userId!, "ghost.status.updated", { ghostId: ghost.id, status: ghost.status });
    await service.trackAnalytics(request.userId!, "ghost_cancelled", { ghostId: ghost.id });
    return ghost;
  });

  app.post("/api/data-mode", { preHandler: requireSession }, async (request) => {
    const { mode } = request.body as { mode?: string };
    if (mode !== "DEMO" && mode !== "LIVE") throw new AppError("INVALID_DATA_MODE", "Choose Guided Scenario or Live Data.", 422);
    const workspace = await service.setDataMode(request.userId!, mode);
    changed(request.userId!, "market.connection.updated", { mode });
    return workspace;
  });

  app.post("/api/demo/step", { preHandler: requireSession }, async (request) => {
    const frame = await service.advanceDemo(request.userId!);
    changed(request.userId!, "market.price.updated", { frameId: frame.id });
    changed(request.userId!, "market.funding.updated", { frameId: frame.id });
    return frame;
  });

  app.post("/api/replay", { preHandler: requireSession }, async (request) => {
    if (!config.features.replay) throw new AppError("FEATURE_DISABLED", "Replay is disabled in this environment.", 404);
    const result = await service.replay(request.userId!, request.body);
    changed(request.userId!, "replay.completed", { backtestId: result.id });
    await service.trackAnalytics(request.userId!, "replay_completed", { backtestId: result.id, period: result.period });
    return result;
  });

  app.post("/api/ai/compose", { preHandler: requireSession }, async (request) => {
    if (!config.features.aiComposer) throw new AppError("FEATURE_DISABLED", "AI Composer is disabled in this environment.", 404);
    const result = await service.composeGhost(request.userId!, request.body);
    await service.trackAnalytics(request.userId!, "ghost_ai_used");
    return result;
  });

  app.get("/api/strategies", { preHandler: requireSession }, async () => service.strategies());
  app.get("/api/execution-targets", { preHandler: requireSession }, async () => service.executionTargets());
  app.post("/api/compiler/preview", { preHandler: requireSession }, async (request) => service.compilerPreview(request.body));
  app.post("/api/strategies/:id/use", { preHandler: requireSession }, async (request) => {
    const { id } = request.params as { id: string };
    const strategy = await service.useStrategy(request.userId!, id);
    changed(request.userId!, "strategy.updated", { strategyId: id });
    await service.trackAnalytics(request.userId!, "strategy_used", { strategyId: id });
    return strategy;
  });

  app.get("/api/live-market", { preHandler: requireSession }, async () => service.liveMarket());

  app.get("/api/events", { preHandler: requireSession }, async (request, reply) => {
    const sessionKey = request.sessionToken!;
    const sessionConnections = sseBySession.get(sessionKey) ?? 0;
    if (sessionConnections >= config.limits.sseConnectionsPerSession || sseTotal >= config.limits.sseConnectionsTotal) {
      return reply.status(429).send({ error: { code: "SSE_CONNECTION_LIMIT", message: "Too many live update connections are open. Close another Triggerlane tab and retry." } });
    }
    sseBySession.set(sessionKey, sessionConnections + 1);
    sseTotal += 1;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173",
      "access-control-allow-credentials": "true",
    });
    const write = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const heartbeat = setInterval(() => write({ type: "heartbeat", at: new Date().toISOString() }), 20_000);
    events.on(request.userId!, write);
    write({ type: "connected", at: new Date().toISOString() });
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      events.off(request.userId!, write);
      const remaining = Math.max(0, (sseBySession.get(sessionKey) ?? 1) - 1);
      if (remaining) sseBySession.set(sessionKey, remaining);
      else sseBySession.delete(sessionKey);
      sseTotal = Math.max(0, sseTotal - 1);
      reply.raw.end();
    });
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = await buildServer();
  const port = Number(process.env.API_PORT ?? 8787);
  const host = process.env.API_HOST ?? "127.0.0.1";
  await app.listen({ host, port });

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
