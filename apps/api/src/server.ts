import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
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

export async function buildServer(database?: PGlite): Promise<FastifyInstance> {
  if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
    throw new Error("SESSION_SECRET must contain at least 32 characters in production.");
  }
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const db = database ?? (await getDatabase());
  const service = new GhostService(db);
  const config = runtimeConfig();
  const events = new EventEmitter();
  const workerId = randomUUID();
  const startedAt = Date.now();
  let requestCount = 0;
  let errorCount = 0;
  let totalResponseMs = 0;
  events.setMaxListeners(200);

  await app.register(cookie, {
    secret: process.env.SESSION_SECRET ?? "ghost-orders-local-session-secret-change-me",
    hook: "onRequest",
  });
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://127.0.0.1:5173",
    credentials: true,
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
    if (!session || !token) throw new AppError("UNAUTHORIZED", "Start a Sandbox session first.", 401);
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

  const backgroundTick = async () => {
    if (await service.acquireWorkerLease(workerId)) {
      await service.publishOutbox((userId, event) => events.emit(userId, event));
    }
  };
  const workerTimer = process.env.NODE_ENV === "test" ? null : setInterval(() => void backgroundTick().catch((error) => app.log.error(error)), 1_000);
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
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "The Sandbox could not complete that action." } });
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
  app.get("/health/diagnostics", async () => {
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
      workerLease: lease.rows[0] ? { active: new Date(lease.rows[0].expires_at).getTime() > Date.now(), owner: lease.rows[0].owner_id.slice(0, 8) } : { active: false, owner: null },
    };
  });

  app.post("/api/session/anonymous", async (request, reply) => {
    const currentToken = readSessionToken(request);
    const current = await service.resolveSession(currentToken);
    if (current) return { userId: current.userId, expiresAt: current.expiresAt };
    const session = await service.createAnonymousSession();
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
  app.get("/api/data-mode", { preHandler: requireSession }, async (request) => service.dataMode(request.userId!));
  app.get("/api/portfolio", { preHandler: requireSession }, async (request) => service.portfolio(request.userId!));
  app.post("/api/portfolio/reset", { preHandler: requireSession }, async (request) => {
    const workspace = await service.resetPortfolio(request.userId!, requireIdempotencyKey(request));
    changed(request.userId!, "portfolio.updated", { reason: "RESET" });
    return workspace;
  });
  app.get("/api/ghosts", { preHandler: requireSession }, async (request) => service.ghosts(request.userId!));
  app.get("/api/ghosts/:id", { preHandler: requireSession }, async (request) => {
    const { id } = request.params as { id: string };
    return service.ghost(request.userId!, id);
  });
  app.patch("/api/ghosts/:id", { preHandler: requireSession }, async (request) => {
    const ghost = await service.updateGhost(request.userId!, (request.params as { id: string }).id, request.body);
    changed(request.userId!, "ghost.status.updated", { ghostId: ghost.id, status: ghost.status });
    return ghost;
  });
  app.get("/api/ghosts/:id/activity", { preHandler: requireSession }, async (request) => service.ghostActivity(request.userId!, (request.params as { id: string }).id));
  app.get("/api/history", { preHandler: requireSession }, async (request) => service.history(request.userId!));
  app.get("/api/executions/:id", { preHandler: requireSession }, async (request) => service.execution(request.userId!, (request.params as { id: string }).id));

  app.post("/api/ghosts", { preHandler: requireSession }, async (request, reply) => {
    const ghost = await service.createGhost(request.userId!, request.body);
    changed(request.userId!, "ghost.status.updated", { ghostId: ghost.id, status: ghost.status });
    return reply.status(201).send(ghost);
  });

  app.post("/api/ghosts/:id/arm", { preHandler: requireSession }, async (request) => {
    const { id } = request.params as { id: string };
    const ghost = await service.armGhost(request.userId!, id, requireIdempotencyKey(request));
    changed(request.userId!, "ghost.status.updated", { ghostId: ghost.id, status: ghost.status });
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
    if (mode !== "DEMO" && mode !== "LIVE") throw new AppError("INVALID_DATA_MODE", "Choose Demo Feed or Live Data.", 422);
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
