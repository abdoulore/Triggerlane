import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import type { MarketView } from "@ghost/domain";
import { createDatabase } from "../src/db";
import { buildServer } from "../src/server";
import { GhostService } from "../src/service";

describe("Ghost API", () => {
  let app: FastifyInstance;
  let database: PGlite;
  let cookie: string;
  let filledGhostId: string;

  const sellDraft = (name: string) => ({
    name,
    side: "SELL",
    amount: "25",
    amountType: "POSITION_PERCENT",
    maxSlippageBps: 50,
    expiresInHours: 24,
    conditions: [
      { metric: "PRICE", operator: "GTE", target: "280" },
      { metric: "FUNDING", operator: "GTE", target: "0.0005" },
      { metric: "PNL", operator: "GTE", target: "0.1" },
    ],
  });
  const mutationHeaders = (sessionCookie = cookie) => ({ cookie: sessionCookie, "idempotency-key": randomUUID() });

  beforeAll(async () => {
    database = await createDatabase(":memory:");
    app = await buildServer(database);
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const setCookie = session.headers["set-cookie"]!;
    cookie = Array.isArray(setCookie) ? setCookie[0]! : setCookie;
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.close();
  }, 30_000);

  it("creates an isolated seeded Sandbox", async () => {
    const response = await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.portfolio.balances.USDC.quantity).toBe("15000");
    expect(body.portfolio.balances.SOL.quantity).toBe("40");
    expect(body.frame.executionEligible).toBe(true);
  });

  it("persists and evaluates a single active condition", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const sessionHeader = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(sessionHeader) ? sessionHeader[0]! : sessionHeader;
    const response = await app.inject({
      method: "POST",
      url: "/api/ghosts",
      headers: { cookie: isolatedCookie },
      payload: { ...sellDraft("Price only guard"), conditions: [{ metric: "PRICE", operator: "GTE", target: "999" }] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().conditions).toHaveLength(1);
    expect(response.json().evaluations).toHaveLength(1);
    const armed = await app.inject({ method: "POST", url: `/api/ghosts/${response.json().id}/arm`, headers: mutationHeaders(isolatedCookie) });
    expect(armed.json().status).toBe("WATCHING");
    expect(armed.json().evaluations.map((evaluation: { metric: string }) => evaluation.metric)).toEqual(["PRICE"]);
  });

  it("evaluates one fresh post-arm frame without firing from pre-arm evidence", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const sessionHeader = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(sessionHeader) ? sessionHeader[0]! : sessionHeader;
    const created = await app.inject({
      method: "POST",
      url: "/api/ghosts",
      headers: { cookie: isolatedCookie },
      payload: {
        side: "BUY",
        amount: "300",
        amountType: "USDC",
        maxSlippageBps: 50,
        expiresInHours: 24,
        name: "Post-arm boundary",
        conditions: [{ metric: "PRICE", operator: "LTE", target: "250" }],
      },
    });
    expect(created.json().evaluations[0]).toMatchObject({ current: "246", satisfied: true });

    const armed = await app.inject({ method: "POST", url: `/api/ghosts/${created.json().id}/arm`, headers: mutationHeaders(isolatedCookie) });
    expect(armed.statusCode).toBe(200);
    expect(armed.json().status).toBe("WATCHING");
    expect(armed.json().evaluations[0]).toMatchObject({ current: "258.4", satisfied: false });
    expect(armed.json().execution).toBeNull();

    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    expect(workspace.portfolio.demoStep).toBe(1);
    expect(workspace.frame.observations.PRICE.value).toBe("258.40");
  });

  it("creates, arms, advances, and fills a Ghost exactly once", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/ghosts",
      headers: { cookie },
      payload: sellDraft("Profit lock"),
    });
    expect(created.statusCode).toBe(201);
    const ghostId = created.json().id;
    filledGhostId = ghostId;
    const armed = await app.inject({ method: "POST", url: `/api/ghosts/${ghostId}/arm`, headers: mutationHeaders() });
    expect(armed.json().status).toBe("WATCHING");

    for (let index = 0; index < 5; index += 1) {
      await app.inject({ method: "POST", url: "/api/demo/step", headers: { cookie } });
    }
    await app.inject({ method: "POST", url: "/api/demo/step", headers: { cookie } });
    const workspace = await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie } });
    const body = workspace.json();
    expect(body.ghosts.find((ghost: { id: string }) => ghost.id === ghostId).status).toBe("FILLED");
    expect(body.executions).toHaveLength(1);
    expect(Number(body.portfolio.balances.SOL.quantity)).toBe(30);
  });

  it("rejects cross-account reads and mutations", async () => {
    const secondSession = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = secondSession.headers["set-cookie"]!;
    const secondCookie = Array.isArray(header) ? header[0]! : header;

    const read = await app.inject({ method: "GET", url: `/api/ghosts/${filledGhostId}`, headers: { cookie: secondCookie } });
    const mutate = await app.inject({ method: "POST", url: `/api/ghosts/${filledGhostId}/cancel`, headers: mutationHeaders(secondCookie) });
    expect(read.statusCode).toBe(404);
    expect(mutate.statusCode).toBe(404);
  });

  it("keeps an explicit user pause across feed updates and releases capital on cancel", async () => {
    await app.inject({ method: "POST", url: "/api/data-mode", headers: { cookie }, payload: { mode: "DEMO" } });
    const created = await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie }, payload: sellDraft("Pause guard") });
    const ghostId = created.json().id;
    await app.inject({ method: "POST", url: `/api/ghosts/${ghostId}/arm`, headers: mutationHeaders() });
    await app.inject({ method: "POST", url: `/api/ghosts/${ghostId}/pause`, headers: { cookie } });
    await app.inject({ method: "POST", url: "/api/demo/step", headers: { cookie } });

    const paused = await app.inject({ method: "GET", url: `/api/ghosts/${ghostId}`, headers: { cookie } });
    expect(paused.json().status).toBe("PAUSED");
    expect(paused.json().pauseReason).toBe("USER");

    await app.inject({ method: "POST", url: `/api/ghosts/${ghostId}/cancel`, headers: mutationHeaders() });
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie } })).json();
    expect(workspace.ghosts.find((ghost: { id: string }) => ghost.id === ghostId).status).toBe("CANCELLED");
    expect(Number(workspace.portfolio.balances.SOL.reserved)).toBe(0);
  });

  it("reports database readiness", async () => {
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, database: "ready" });
    const diagnostics = await app.inject({ method: "GET", url: "/health/diagnostics" });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({ ok: true, executionAttemptsInFlight: 0 });
  });

  it("reports retention candidates without enabling deletion", async () => {
    const retention = await app.inject({ method: "GET", url: "/health/retention" });
    expect(retention.statusCode).toBe(200);
    expect(retention.json()).toMatchObject({ dryRun: true, deletionEnabled: false, retentionDays: 90 });
    expect(retention.headers["x-content-type-options"]).toBe("nosniff");
    expect(retention.headers["x-frame-options"]).toBe("DENY");
  });

  it("automatically pauses stale frames and recovers only on a complete frame", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/ghosts",
      headers: { cookie },
      payload: { ...sellDraft("Data guard"), conditions: [{ metric: "PRICE", operator: "GTE", target: "999" }] },
    });
    const ghostId = created.json().id;
    await app.inject({ method: "POST", url: `/api/ghosts/${ghostId}/arm`, headers: mutationHeaders() });
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie } })).json();
    const service = new GhostService(database);
    await service.processEvaluationFrame(workspace.identity.id, { ...workspace.frame, id: randomUUID(), completeness: "STALE", executionEligible: false });

    let ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${ghostId}`, headers: { cookie } })).json();
    expect(ghost.status).toBe("PAUSED");
    expect(ghost.pauseReason).toBe("DATA_STALE");

    await service.processEvaluationFrame(workspace.identity.id, { ...workspace.frame, id: randomUUID(), completeness: "COMPLETE", executionEligible: true });
    ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${ghostId}`, headers: { cookie } })).json();
    expect(ghost.status).toBe("WATCHING");
    expect(ghost.pauseReason).toBeNull();
  });

  it("blocks excessive slippage without consuming the reservation", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/ghosts",
      headers: { cookie },
      payload: {
        ...sellDraft("Slippage guard"),
        maxSlippageBps: 1,
        conditions: [
          { metric: "PRICE", operator: "GTE", target: "1" },
          { metric: "FUNDING", operator: "GTE", target: "0" },
          { metric: "PNL", operator: "GTE", target: "-1" },
        ],
      },
    });
    const ghostId = created.json().id;
    await app.inject({ method: "POST", url: `/api/ghosts/${ghostId}/arm`, headers: mutationHeaders() });
    await app.inject({ method: "POST", url: "/api/demo/step", headers: { cookie } });
    const ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${ghostId}`, headers: { cookie } })).json();
    expect(ghost.status).toBe("WATCHING");
    expect(ghost.reservation.status).toBe("ACTIVE");
    expect(ghost.activities.some((activity: { type: string }) => activity.type === "EXECUTION_BLOCKED")).toBe(true);
    const history = (await app.inject({ method: "GET", url: "/api/history", headers: { cookie } })).json();
    const attempt = history.attempts.find((item: { ghostId: string }) => item.ghostId === ghostId);
    expect(attempt).toMatchObject({ status: "BLOCKED", ghostName: "Slippage guard", maxSlippageBps: 1 });
    expect(attempt.frame).toMatchObject({ completeness: "COMPLETE", executionEligible: true });
    expect(attempt.reason.message).toContain("exceeded the configured limit");
    expect(attempt.reason.metadata.quote.modelVersion).toBe("sandbox-v1");
  });

  it("replays an arm request idempotently", async () => {
    const created = await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie }, payload: sellDraft("Retry guard") });
    const ghostId = created.json().id;
    const key = randomUUID();
    const headers = { cookie, "idempotency-key": key };
    const first = await app.inject({ method: "POST", url: `/api/ghosts/${ghostId}/arm`, headers });
    const replay = await app.inject({ method: "POST", url: `/api/ghosts/${ghostId}/arm`, headers });
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().reservation.id).toBe(first.json().reservation.id);
  });

  it("prevents concurrent Ghosts from over-reserving one portfolio", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const setCookie = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(setCookie) ? setCookie[0]! : setCookie;
    const payload = { ...sellDraft("Concurrent A"), amount: "75" };
    const firstGhost = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload })).json();
    const secondGhost = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: { ...payload, name: "Concurrent B" } })).json();
    const results = await Promise.all([
      app.inject({ method: "POST", url: `/api/ghosts/${firstGhost.id}/arm`, headers: mutationHeaders(isolatedCookie) }),
      app.inject({ method: "POST", url: `/api/ghosts/${secondGhost.id}/arm`, headers: mutationHeaders(isolatedCookie) }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const isolated = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    expect(Number(isolated.portfolio.balances.SOL.reserved)).toBe(30);
    expect(Number(isolated.portfolio.balances.SOL.available)).toBe(10);
  });

  it("rebuilds owned balances exactly from immutable ledger entries", async () => {
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie } })).json();
    const rebuilt = await database.query<{ asset: string; quantity: string }>(
      "SELECT asset, SUM(amount_decimal)::text AS quantity FROM ledger_entries WHERE portfolio_id = $1 GROUP BY asset",
      [workspace.portfolio.id],
    );
    const quantities = Object.fromEntries(rebuilt.rows.map((row) => [row.asset, Number(row.quantity)]));
    expect(quantities.SOL).toBeCloseTo(Number(workspace.portfolio.balances.SOL.quantity), 9);
    expect(quantities.USDC).toBeCloseTo(Number(workspace.portfolio.balances.USDC.quantity), 6);
  });

  it("exposes a reconciled portfolio ledger and names every reservation owner", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const created = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Portfolio owner") })).json();
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/arm`, headers: mutationHeaders(isolatedCookie) });

    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    expect(workspace.ledger).toHaveLength(1);
    expect(workspace.ledger[0]).toMatchObject({ type: "SEED" });
    const seededAmounts = Object.fromEntries(workspace.ledger[0].entries.map((entry: { asset: string; amount: string }) => [entry.asset, Number(entry.amount)]));
    expect(seededAmounts).toEqual({ SOL: 40, USDC: 15000 });
    expect(workspace.reservations).toEqual([
      expect.objectContaining({ ghostId: created.id, ghostName: "Portfolio owner", asset: "SOL", status: "ACTIVE" }),
    ]);
    expect(Number(workspace.reservations[0].amount)).toBe(10);
  });

  it("publishes a persisted outbox event once after a publisher restart", async () => {
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie } })).json();
    const eventId = randomUUID();
    await database.query(
      "INSERT INTO outbox_events (id, user_id, event_type, payload, created_at) VALUES ($1, $2, 'workspace.updated', $3, NOW())",
      [eventId, workspace.identity.id, JSON.stringify({ marker: eventId })],
    );
    const delivered: string[] = [];
    const restartedPublisher = new GhostService(database);
    await restartedPublisher.publishOutbox((_userId, event) => {
      if (event.marker === eventId) delivered.push(event.marker as string);
    });
    await restartedPublisher.publishOutbox((_userId, event) => {
      if (event.marker === eventId) delivered.push(event.marker as string);
    });
    expect(delivered).toEqual([eventId]);
    const persisted = await database.query<{ delivery_count: number; published_at: string | null }>(
      "SELECT delivery_count, published_at FROM outbox_events WHERE id = $1",
      [eventId],
    );
    expect(persisted.rows[0]).toMatchObject({ delivery_count: 1 });
    expect(persisted.rows[0]?.published_at).not.toBeNull();
  });

  it("allows only one worker lease owner and supports takeover after expiry", async () => {
    const firstWorker = new GhostService(database);
    const secondWorker = new GhostService(database);
    await database.query("DELETE FROM worker_leases WHERE partition_key = 'SOL/USDC'");
    expect(await firstWorker.acquireWorkerLease("worker-a", 15)).toBe(true);
    expect(await secondWorker.acquireWorkerLease("worker-b", 15)).toBe(false);
    await database.query("UPDATE worker_leases SET expires_at = NOW() - INTERVAL '1 second' WHERE partition_key = 'SOL/USDC'");
    expect(await secondWorker.acquireWorkerLease("worker-b", 15)).toBe(true);
  });

  it("expires paused triggers and releases capital without a market frame", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const created = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Paused deadline") })).json();
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/arm`, headers: mutationHeaders(isolatedCookie) });
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/pause`, headers: { cookie: isolatedCookie } });
    await database.query("UPDATE ghosts SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1", [created.id]);

    await database.query("DELETE FROM worker_leases WHERE partition_key='SOL/USDC'");
    const restartedService = new GhostService(database);
    const firstTick = await restartedService.runMaintenanceTick("expiry-test-worker", () => undefined);
    const secondTick = await restartedService.runMaintenanceTick("expiry-test-worker", () => undefined);
    expect(firstTick).toMatchObject({ leaseAcquired: true, expired: 1 });
    expect(secondTick).toMatchObject({ leaseAcquired: true, expired: 0 });

    const ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}`, headers: { cookie: isolatedCookie } })).json();
    expect(ghost.status).toBe("EXPIRED");
    expect(ghost.reservation.status).toBe("RELEASED");
    expect(ghost.activities.filter((activity: { type: string }) => activity.type === "EXPIRED")).toHaveLength(1);
  });

  it("expires after stale market data pauses evaluation", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    const created = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Stale deadline") })).json();
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/arm`, headers: mutationHeaders(isolatedCookie) });
    const staleFrame = { ...workspace.frame, id: randomUUID(), completeness: "STALE", executionEligible: false };
    await new GhostService(database).processEvaluationFrame(workspace.identity.id, staleFrame);
    await database.query("UPDATE ghosts SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [created.id]);

    expect(await new GhostService(database).expireDueGhosts()).toBe(1);
    const ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}`, headers: { cookie: isolatedCookie } })).json();
    expect(ghost.status).toBe("EXPIRED");
    expect(ghost.reservation.status).toBe("RELEASED");
  });

  it("expires draft triggers without requiring a market frame", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const created = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Draft deadline") })).json();
    await database.query("UPDATE ghosts SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [created.id]);

    expect(await new GhostService(database).expireDueGhosts()).toBe(1);
    const ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}`, headers: { cookie: isolatedCookie } })).json();
    expect(ghost.status).toBe("EXPIRED");
    expect(ghost.reservation).toBeNull();
  });

  it("expires a trigger paused by Live Data without a new frame", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const created = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Live deadline") })).json();
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/arm`, headers: mutationHeaders(isolatedCookie) });
    await app.inject({ method: "POST", url: "/api/data-mode", headers: { cookie: isolatedCookie }, payload: { mode: "LIVE" } });
    await database.query("UPDATE ghosts SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [created.id]);

    expect(await new GhostService(database).expireDueGhosts()).toBe(1);
    const ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}`, headers: { cookie: isolatedCookie } })).json();
    expect(ghost.status).toBe("EXPIRED");
    expect(ghost.reservation.status).toBe("RELEASED");
  });

  it("keeps reset atomic when portfolio replacement fails", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const before = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    const created = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Rollback boundary") })).json();
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/arm`, headers: mutationHeaders(isolatedCookie) });
    const failingService = new GhostService(database, {
      beforePortfolioReplacement: () => { throw new Error("injected reset failure"); },
    });

    await expect(failingService.resetPortfolio(before.identity.id, randomUUID())).rejects.toThrow("injected reset failure");
    const after = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    const ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}`, headers: { cookie: isolatedCookie } })).json();
    expect(after.portfolio.id).toBe(before.portfolio.id);
    expect(ghost.status).toBe("WATCHING");
    expect(ghost.reservation.status).toBe("ACTIVE");
  });

  it("serializes reset and deadline sweeping without leaking capital", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const before = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    const created = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Concurrent deadline") })).json();
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/arm`, headers: mutationHeaders(isolatedCookie) });
    await database.query("UPDATE ghosts SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [created.id]);
    const service = new GhostService(database);

    await Promise.all([service.resetPortfolio(before.identity.id, randomUUID()), service.expireDueGhosts()]);
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    const ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}`, headers: { cookie: isolatedCookie } })).json();
    expect(["CANCELLED", "EXPIRED"]).toContain(ghost.status);
    expect(ghost.reservation.status).toBe("RELEASED");
    expect(Number(workspace.portfolio.balances.SOL.quantity)).toBe(40);
    expect(Number(workspace.portfolio.balances.USDC.quantity)).toBe(15000);
    expect(workspace.executions).toHaveLength(0);
  });

  it("serializes cancellation and deadline sweeping to one terminal outcome", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    const created = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Cancel deadline") })).json();
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/arm`, headers: mutationHeaders(isolatedCookie) });
    await database.query("UPDATE ghosts SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [created.id]);
    const service = new GhostService(database);

    const outcomes = await Promise.allSettled([
      service.cancelGhost(workspace.identity.id, created.id, randomUUID()),
      service.expireDueGhosts(),
    ]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
    const ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}`, headers: { cookie: isolatedCookie } })).json();
    expect(["CANCELLED", "EXPIRED"]).toContain(ghost.status);
    expect(ghost.reservation.status).toBe("RELEASED");
    const releaseEvents = await database.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM capital_reservation_events WHERE reservation_id=$1 AND to_status='RELEASED'",
      [ghost.reservation.id],
    );
    expect(Number(releaseEvents.rows[0]?.count ?? 0)).toBe(1);
  });

  it("rolls settlement back when a failure occurs before commit", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const before = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    const created = (await app.inject({
      method: "POST",
      url: "/api/ghosts",
      headers: { cookie: isolatedCookie },
      payload: { ...sellDraft("Settlement rollback"), conditions: [{ metric: "PRICE", operator: "GTE", target: "270" }] },
    })).json();
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/arm`, headers: mutationHeaders(isolatedCookie) });
    const failingService = new GhostService(database, {
      beforeSettlementCommit: () => { throw new Error("injected settlement failure"); },
    });

    await expect(failingService.advanceDemo(before.identity.id)).rejects.toThrow("injected settlement failure");
    const after = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    const ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}`, headers: { cookie: isolatedCookie } })).json();
    expect(after.portfolio.demoStep).toBe(1);
    expect(after.portfolio.balances.SOL.quantity).toBe(before.portfolio.balances.SOL.quantity);
    expect(after.portfolio.balances.USDC.quantity).toBe(before.portfolio.balances.USDC.quantity);
    expect(ghost.status).toBe("WATCHING");
    expect(ghost.reservation.status).toBe("ACTIVE");
    expect(ghost.execution).toBeNull();
  });

  it("rejects an idempotency key reused for a different trigger", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const first = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Key owner") })).json();
    const second = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Key mismatch") })).json();
    const key = randomUUID();
    const armed = await app.inject({ method: "POST", url: `/api/ghosts/${first.id}/arm`, headers: { cookie: isolatedCookie, "idempotency-key": key } });
    const mismatch = await app.inject({ method: "POST", url: `/api/ghosts/${second.id}/arm`, headers: { cookie: isolatedCookie, "idempotency-key": key } });
    expect(armed.statusCode).toBe(200);
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("keeps archived portfolio triggers from executing after reset", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const before = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    const created = (await app.inject({
      method: "POST",
      url: "/api/ghosts",
      headers: { cookie: isolatedCookie },
      payload: { ...sellDraft("Reset boundary"), conditions: [{ metric: "PRICE", operator: "GTE", target: "270" }] },
    })).json();
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/arm`, headers: mutationHeaders(isolatedCookie) });

    const reset = await app.inject({ method: "POST", url: "/api/portfolio/reset", headers: mutationHeaders(isolatedCookie) });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().portfolio.id).not.toBe(before.portfolio.id);
    await app.inject({ method: "POST", url: "/api/demo/step", headers: { cookie: isolatedCookie } });
    await app.inject({ method: "POST", url: "/api/demo/step", headers: { cookie: isolatedCookie } });

    const oldGhost = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}`, headers: { cookie: isolatedCookie } })).json();
    const after = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    expect(oldGhost.status).toBe("CANCELLED");
    expect(oldGhost.reservation.status).toBe("RELEASED");
    expect(Number(after.portfolio.balances.SOL.quantity)).toBe(40);
    expect(Number(after.portfolio.balances.USDC.quantity)).toBe(15000);
    expect(after.executions).toHaveLength(0);
  });

  it("keeps archived generation receipts available without mixing them into current balances", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const created = (await app.inject({
      method: "POST",
      url: "/api/ghosts",
      headers: { cookie: isolatedCookie },
      payload: { ...sellDraft("Archived receipt"), conditions: [{ metric: "PRICE", operator: "LTE", target: "1000" }] },
    })).json();
    await app.inject({ method: "POST", url: `/api/ghosts/${created.id}/arm`, headers: mutationHeaders(isolatedCookie) });
    await app.inject({ method: "POST", url: "/api/demo/step", headers: { cookie: isolatedCookie } });
    const settled = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    expect(settled.executions).toHaveLength(1);

    await app.inject({ method: "POST", url: "/api/portfolio/reset", headers: mutationHeaders(isolatedCookie) });
    const current = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    expect(current.executions).toHaveLength(0);
    expect(current.archivedExecutions).toHaveLength(1);
    expect(current.archivedExecutions[0]).toMatchObject({ ghost_name: "Archived receipt", portfolioGeneration: 1 });
    expect(Number(current.portfolio.balances.SOL.quantity)).toBe(40);
    expect(Number(current.portfolio.balances.USDC.quantity)).toBe(15000);
  });

  it("reports clean portfolio-generation integrity", async () => {
    const response = await app.inject({ method: "GET", url: "/health/integrity" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      violations: {
        ownershipMismatch: 0,
        reservationPortfolioMismatch: 0,
        framePortfolioMismatch: 0,
        executionPortfolioMismatch: 0,
        archivedNonterminalGhosts: 0,
        orphanedOpenReservations: 0,
      },
    });
  });

  it("does not combine conditions from different frames", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const created = await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: sellDraft("Frame guard") });
    const ghostId = created.json().id;
    await app.inject({ method: "POST", url: `/api/ghosts/${ghostId}/arm`, headers: mutationHeaders(isolatedCookie) });
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: isolatedCookie } })).json();
    const service = new GhostService(database);
    const priceOnly = structuredClone(workspace.frame);
    priceOnly.id = randomUUID();
    priceOnly.observations.PRICE.value = "281";
    priceOnly.observations.FUNDING.value = "0.0004";
    priceOnly.observations.PNL.value = "0.2";
    const fundingOnly = structuredClone(priceOnly);
    fundingOnly.id = randomUUID();
    fundingOnly.observations.PRICE.value = "279";
    fundingOnly.observations.FUNDING.value = "0.0006";
    await service.processEvaluationFrame(workspace.identity.id, priceOnly);
    await service.processEvaluationFrame(workspace.identity.id, fundingOnly);
    const ghost = (await app.inject({ method: "GET", url: `/api/ghosts/${ghostId}`, headers: { cookie: isolatedCookie } })).json();
    expect(ghost.status).toBe("WATCHING");
    expect(ghost.execution).toBeNull();
  });

  it("runs and persists a complete deterministic historical Replay", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/replay",
      headers: { cookie },
      payload: { period: "7D", draft: sellDraft("Replay test") },
    });
    expect(response.statusCode).toBe(200);
    const replay = response.json();
    expect(replay).toMatchObject({ status: "COMPLETE", label: "Historical simulation" });
    expect(replay.provider).toMatchObject({ mode: "HISTORICAL", provenance: "DEMO", liveHistory: false });
    expect(replay.summary.frameCount).toBe(42);
    expect(replay.summary.completeFrameCount).toBe(42);
    expect(replay.summary.triggerCount).toBeGreaterThan(0);
    expect(replay.points.filter((point: { triggered: boolean }) => point.triggered)).toHaveLength(replay.summary.triggerCount);
    const stored = await database.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM backtests WHERE id = $1", [replay.id]);
    expect(stored.rows[0]?.count).toBe("1");
  });

  it("rejects unsupported Replay periods instead of fabricating history", async () => {
    const response = await app.inject({ method: "POST", url: "/api/replay", headers: { cookie }, payload: { period: "1Y", draft: sellDraft("Unsupported") } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("INVALID_REPLAY_PERIOD");
  });

  it("composes and validates an editable Ghost from natural language", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/compose",
      headers: { cookie },
      payload: {
        prompt: "Sell half my SOL when it reaches $300, funding is above 0.05%, and profit is at least 40%. Maximum 0.5% slippage for 7 days.",
        baseDraft: sellDraft("Current draft"),
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.draft).toMatchObject({ name: "AI SOL exit", amount: "50", maxSlippageBps: 50, expiresInHours: 168 });
    expect(body.draft.conditions.map((condition: { target: string }) => condition.target)).toEqual(["300", "0.0005", "0.4"]);
    expect(body.parser).toMatchObject({ mode: "DETERMINISTIC", modelProvider: null, supportedMarket: "SOL/USDC" });
    expect(body.insights).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Long monitoring window", action: "REPLAY" })]));
    expect(body.disclaimer).toContain("does not provide investment advice");
  });

  it("rejects unauthenticated or underspecified AI compose requests", async () => {
    const unauthorized = await app.inject({ method: "POST", url: "/api/ai/compose", payload: { prompt: "Sell half my SOL", baseDraft: sellDraft("Current draft") } });
    expect(unauthorized.statusCode).toBe(401);
    const invalid = await app.inject({ method: "POST", url: "/api/ai/compose", headers: { cookie }, payload: { prompt: "sell", baseDraft: sellDraft("Current draft") } });
    expect(invalid.statusCode).toBe(422);
  });

  it("discovers persisted schema-valid strategies and records usage", async () => {
    const response = await app.inject({ method: "GET", url: "/api/strategies", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.title).toBe("Triggerlane Strategies");
    expect(body.categories).toEqual(["Popular", "Accumulation", "Profit Taking", "Protection", "Advanced"]);
    expect(body.strategies).toHaveLength(4);
    expect(body.capabilities.unsupportedAdvancedMetrics).toEqual(["LIQUIDITY", "TVL", "VOLUME"]);
    expect(body.strategies.map((strategy: { draft: { conditions: unknown[] } }) => strategy.draft.conditions.length)).toEqual([3, 3, 3, 1]);

    const used = await app.inject({ method: "POST", url: "/api/strategies/euphoria-exit/use", headers: { cookie } });
    expect(used.statusCode).toBe(200);
    expect(used.json().draft.name).toBe("Euphoria Exit");
    const activity = await database.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM ghost_activities WHERE user_id = $1 AND type = 'STRATEGY_USED'", [(await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie } })).json().identity.id]);
    expect(activity.rows[0]?.count).toBe("1");
  });

  it("enables Live market data for virtual execution", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "LIVE" } });
    const header = session.headers["set-cookie"]!;
    const liveCookie = Array.isArray(header) ? header[0]! : header;
    const response = await app.inject({ method: "GET", url: "/api/data-mode", headers: { cookie: liveCookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mode: "LIVE", executionEligible: true, executionType: "VIRTUAL" });
  });

  it("fills a Live paper trigger from a post-arm provider frame without a browser and deduplicates the snapshot", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "LIVE" } });
    const header = session.headers["set-cookie"]!;
    const liveCookie = Array.isArray(header) ? header[0]! : header;
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie: liveCookie } })).json();
    const created = await app.inject({
      method: "POST",
      url: "/api/ghosts",
      headers: { cookie: liveCookie },
      payload: { name: "Live paper entry", side: "BUY", amount: "300", amountType: "USDC", maxSlippageBps: 50, expiresInHours: 24, conditions: [{ metric: "PRICE", operator: "LTE", target: "300" }] },
    });
    const armed = await app.inject({ method: "POST", url: `/api/ghosts/${created.json().id}/arm`, headers: mutationHeaders(liveCookie) });
    expect(armed.json().status).toBe("WATCHING");

    const receivedAt = new Date().toISOString();
    const liveView: MarketView = {
      mode: "LIVE",
      instrument: { symbol: "SOL-PERP", displayName: "SOL perpetual", quoteAsset: "USDC", priceType: "MARK_PRICE" },
      provider: "Hyperliquid",
      snapshotId: "hl:test-paper-frame",
      price: { value: "250", unit: "USDC_PER_SOL" },
      funding: { value: "0.00003", unit: "RATIO", period: "1H" },
      sourceTimestamp: null,
      receivedAt,
      status: "FRESH",
      executionEligible: true,
      eligibilityReason: "Fresh Live frame for virtual execution.",
      change: { value: "0.01", label: "24H" },
      history: { status: "AVAILABLE", interval: "1m", points: [{ id: "test", at: receivedAt, value: "250" }], reason: null },
    };
    const worker = new GhostService(database, {}, { view: async () => liveView });
    expect((await worker.processLivePaperTick()).frames).toBeGreaterThan(0);
    expect((await app.inject({ method: "GET", url: `/api/ghosts/${created.json().id}`, headers: { cookie: liveCookie } })).json()).toMatchObject({ status: "FILLED", execution: { receipt: { executionMode: "SIMULATED" } } });

    expect(await worker.processLivePaperTick()).toMatchObject({ frames: 0, paused: 0 });
    const stored = await database.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM evaluation_frames WHERE portfolio_id=$1 AND mode='LIVE'", [workspace.portfolio.id]);
    expect(stored.rows[0]?.count).toBe("1");
  });

  it("pauses Live paper triggers on provider failure and resumes on the next fresh frame", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "LIVE" } });
    const header = session.headers["set-cookie"]!;
    const liveCookie = Array.isArray(header) ? header[0]! : header;
    const created = await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: liveCookie }, payload: { name: "Recovery guard", side: "BUY", amount: "100", amountType: "USDC", maxSlippageBps: 50, expiresInHours: 24, conditions: [{ metric: "PRICE", operator: "LTE", target: "100" }] } });
    await app.inject({ method: "POST", url: `/api/ghosts/${created.json().id}/arm`, headers: mutationHeaders(liveCookie) });

    let view: MarketView = {
      mode: "LIVE",
      instrument: { symbol: "SOL-PERP", displayName: "SOL perpetual", quoteAsset: "USDC", priceType: "MARK_PRICE" },
      provider: "Hyperliquid",
      snapshotId: null,
      price: { value: null, unit: "USDC_PER_SOL" },
      funding: { value: null, unit: "RATIO", period: "1H" },
      sourceTimestamp: null,
      receivedAt: null,
      status: "UNAVAILABLE",
      executionEligible: false,
      eligibilityReason: "Provider offline.",
      change: { value: null, label: null },
      history: { status: "UNAVAILABLE", interval: "1m", points: [], reason: "Provider offline." },
    };
    const worker = new GhostService(database, {}, { view: async () => view });
    expect((await worker.processLivePaperTick()).paused).toBe(1);
    expect((await app.inject({ method: "GET", url: `/api/ghosts/${created.json().id}`, headers: { cookie: liveCookie } })).json()).toMatchObject({ status: "PAUSED", pauseReason: "DATA_STALE" });

    const receivedAt = new Date().toISOString();
    view = { ...view, snapshotId: "hl:test-recovery", price: { value: "250", unit: "USDC_PER_SOL" }, funding: { value: "0", unit: "RATIO", period: "1H" }, receivedAt, status: "FRESH", executionEligible: true, eligibilityReason: "Fresh Live frame.", history: { status: "AVAILABLE", interval: "1m", points: [], reason: null } };
    expect((await worker.processLivePaperTick()).frames).toBeGreaterThan(0);
    expect((await app.inject({ method: "GET", url: `/api/ghosts/${created.json().id}`, headers: { cookie: liveCookie } })).json()).toMatchObject({ status: "WATCHING", pauseReason: null });
  });

  it("reports execution target capabilities without claiming Rialo access", async () => {
    const response = await app.inject({ method: "GET", url: "/api/execution-targets", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.targets.find((target: { target: string }) => target.target === "SANDBOX")).toMatchObject({ configured: true, executionVenue: "SANDBOX_LEDGER" });
    expect(body.targets.find((target: { target: string }) => target.target === "RIALO")).toMatchObject({ configured: false, executionVenue: "UNAVAILABLE" });
  });

  it("previews a shared GhostIR and refuses to produce Rialo network artifacts", async () => {
    const response = await app.inject({ method: "POST", url: "/api/compiler/preview", headers: { cookie }, payload: sellDraft("Compiler preview") });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ir).toMatchObject({ version: 1, semantics: { oneShot: true, evaluationMode: "COMPLETE_FRAME" } });
    expect(body.compilations.find((item: { target: string }) => item.target === "SANDBOX")).toMatchObject({ status: "DEPLOYABLE", deployable: true });
    expect(body.compilations.find((item: { target: string }) => item.target === "RIALO")).toMatchObject({ status: "NOT_CONFIGURED", deployable: false, workflow: null });
    expect(body.networkArtifacts).toBeNull();
  });

  it("publishes environment capabilities without enabling unconfigured Rialo", async () => {
    const response = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ environment: "development", executionMode: "SANDBOX", features: { aiComposer: true, replay: true, demoFeed: true, rialo: false, multiStage: false, advancedConditions: false } });
  });

  it("exposes the documented owned resource routes", async () => {
    await app.inject({ method: "POST", url: "/api/data-mode", headers: { cookie }, payload: { mode: "DEMO" } });
    const [markets, market, mode, portfolio, ghosts, history] = await Promise.all([
      app.inject({ method: "GET", url: "/api/markets", headers: { cookie } }),
      app.inject({ method: "GET", url: "/api/markets/SOL", headers: { cookie } }),
      app.inject({ method: "GET", url: "/api/data-mode", headers: { cookie } }),
      app.inject({ method: "GET", url: "/api/portfolio", headers: { cookie } }),
      app.inject({ method: "GET", url: "/api/ghosts", headers: { cookie } }),
      app.inject({ method: "GET", url: "/api/history", headers: { cookie } }),
    ]);
    expect(markets.json().markets[0]).toMatchObject({ symbol: "SOL-PERP/USDC", instrument: "SOL-PERP", priceType: "MARK_PRICE", liveExecutionEligible: true, executionType: "VIRTUAL" });
    expect(market.json()).toMatchObject({ asset: "SOL", quoteAsset: "USDC" });
    expect(mode.json()).toMatchObject({ executionEligible: true });
    expect(portfolio.json().balances).toHaveProperty("USDC");
    expect(Array.isArray(ghosts.json())).toBe(true);
    expect(history.json()).toHaveProperty("executions");
    for (const response of [markets, market, mode, portfolio, ghosts, history]) expect(response.statusCode).toBe(200);
  });

  it("returns only stored Demo observations as chart history", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const first = await app.inject({ method: "GET", url: "/api/market-view", headers: { cookie: isolatedCookie } });
    expect(first.json()).toMatchObject({
      mode: "DEMO",
      instrument: { symbol: "SOL-PERP", priceType: "SIMULATED_MARK" },
      funding: { period: "DEMO_STEP" },
      change: { value: null, label: null },
      history: { status: "AVAILABLE", interval: "DEMO_STEP" },
    });
    expect(first.json().history.points).toHaveLength(1);

    await app.inject({ method: "POST", url: "/api/demo/step", headers: { cookie: isolatedCookie } });
    const second = (await app.inject({ method: "GET", url: "/api/market-view", headers: { cookie: isolatedCookie } })).json();
    expect(second.history.points).toHaveLength(2);
    expect(second.history.points.map((point: { value: string }) => Number(point.value))).toEqual([246, 258.4]);
    expect(second.change).toMatchObject({ label: "SIMULATION_PERIOD" });
  });

  it("updates only a draft with optimistic configuration versioning", async () => {
    const created = await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie }, payload: sellDraft("Editable draft") });
    const ghost = created.json();
    const updated = await app.inject({ method: "PATCH", url: `/api/ghosts/${ghost.id}`, headers: { cookie }, payload: { expectedConfigurationVersion: ghost.configurationVersion, draft: sellDraft("Edited draft") } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: "Edited draft", configurationVersion: ghost.configurationVersion + 1 });
    const conflict = await app.inject({ method: "PATCH", url: `/api/ghosts/${ghost.id}`, headers: { cookie }, payload: { expectedConfigurationVersion: ghost.configurationVersion, draft: sellDraft("Stale edit") } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("CONFIGURATION_CONFLICT");
    const activity = await app.inject({ method: "GET", url: `/api/ghosts/${ghost.id}/activity`, headers: { cookie } });
    expect(activity.json().items[0]).toMatchObject({ type: "CONFIGURATION_UPDATED" });
  });

  it("accepts exactly one of two concurrent edits at the same configuration version", async () => {
    const created = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie }, payload: sellDraft("Concurrent draft") })).json();
    const responses = await Promise.all([
      app.inject({ method: "PATCH", url: `/api/ghosts/${created.id}`, headers: { cookie }, payload: { expectedConfigurationVersion: created.configurationVersion, draft: sellDraft("First concurrent edit") } }),
      app.inject({ method: "PATCH", url: `/api/ghosts/${created.id}`, headers: { cookie }, payload: { expectedConfigurationVersion: created.configurationVersion, draft: sellDraft("Second concurrent edit") } }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const count = await database.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM ghost_activities WHERE ghost_id=$1 AND type='CONFIGURATION_UPDATED'", [created.id]);
    expect(Number(count.rows[0]?.count)).toBe(1);
  });

  it("paginates a scoped activity trail beyond the workspace window", async () => {
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie } })).json();
    const created = (await app.inject({ method: "POST", url: "/api/ghosts", headers: { cookie }, payload: sellDraft("Long audit trail") })).json();
    await database.query(
      `INSERT INTO ghost_activities (id,user_id,ghost_id,type,message,metadata,created_at)
       SELECT $1 || '-' || value::text, $2, $3, 'AUDIT_EVENT', 'Stored event ' || value::text, '{}'::jsonb, NOW() - (value * INTERVAL '1 second')
       FROM generate_series(1,85) AS value`,
      [randomUUID(), workspace.identity.id, created.id],
    );
    const first = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}/activity?limit=40`, headers: { cookie } })).json();
    const second = (await app.inject({ method: "GET", url: `/api/ghosts/${created.id}/activity?limit=40&cursor=${encodeURIComponent(first.nextCursor)}`, headers: { cookie } })).json();
    expect(first.items).toHaveLength(40);
    expect(second.items).toHaveLength(40);
    expect(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size).toBe(80);
    expect(second.nextCursor).toBeTruthy();
  });

  it("paginates triggers, outcomes, and ledger with independent totals", async () => {
    const triggers = (await app.inject({ method: "GET", url: "/api/ghost-pages?limit=2", headers: { cookie } })).json();
    expect(triggers.items).toHaveLength(2);
    expect(triggers.total).toBeGreaterThanOrEqual(triggers.items.length);
    expect(triggers.nextCursor).toBeTruthy();
    const next = (await app.inject({ method: "GET", url: `/api/ghost-pages?limit=2&cursor=${encodeURIComponent(triggers.nextCursor)}`, headers: { cookie } })).json();
    expect(next.items.some((item: { id: string }) => triggers.items.some((first: { id: string }) => first.id === item.id))).toBe(false);

    const history = (await app.inject({ method: "GET", url: "/api/history-pages?limit=1", headers: { cookie } })).json();
    expect(history.items).toHaveLength(1);
    expect(history.total).toBeGreaterThanOrEqual(1);
    expect(history.counts).toBeTypeOf("object");

    const ledger = (await app.inject({ method: "GET", url: "/api/ledger-pages?limit=1", headers: { cookie } })).json();
    expect(ledger.items).toHaveLength(1);
    expect(ledger.total).toBeGreaterThanOrEqual(1);
    expect(ledger.items[0].entries.length).toBeGreaterThan(0);
  });

  it("resets a portfolio idempotently into a new seeded generation", async () => {
    const session = await app.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const before = (await app.inject({ method: "GET", url: "/api/portfolio", headers: { cookie: isolatedCookie } })).json();
    const key = randomUUID();
    const first = await app.inject({ method: "POST", url: "/api/portfolio/reset", headers: { cookie: isolatedCookie, "idempotency-key": key } });
    const replay = await app.inject({ method: "POST", url: "/api/portfolio/reset", headers: { cookie: isolatedCookie, "idempotency-key": key } });
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(first.json().portfolio.id).not.toBe(before.id);
    expect(replay.json().portfolio.id).toBe(first.json().portfolio.id);
    expect(first.json().portfolio.balances).toMatchObject({ USDC: { quantity: "15000" }, SOL: { quantity: "40" } });
  });

  it("records local analytics and granular outbox events", async () => {
    const workspace = (await app.inject({ method: "GET", url: "/api/workspace", headers: { cookie } })).json();
    const analytics = await database.query<{ event_name: string }>("SELECT event_name FROM analytics_events WHERE user_id=$1 ORDER BY created_at", [workspace.identity.id]);
    expect(analytics.rows.map((row) => row.event_name)).toEqual(expect.arrayContaining(["sandbox_started", "ghost_armed", "replay_completed", "ghost_ai_used", "strategy_used"]));
    const outbox = await database.query<{ event_type: string }>("SELECT DISTINCT event_type FROM outbox_events WHERE user_id=$1", [workspace.identity.id]);
    expect(outbox.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining(["ghost.status.updated", "ghost.execution.completed", "market.connection.updated", "replay.completed", "strategy.updated"]));
  });

  it("returns explicit 429 responses for account creation and trigger quotas", async () => {
    const limitedApp = await buildServer(database, { anonymousSessionsPerIpPerHour: 1, triggersPerAccount: 1 });
    const session = await limitedApp.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    const header = session.headers["set-cookie"]!;
    const isolatedCookie = Array.isArray(header) ? header[0]! : header;
    const secondSession = await limitedApp.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
    expect(secondSession.statusCode).toBe(429);
    expect(secondSession.headers["retry-after"]).toBeTruthy();
    expect(secondSession.json().error.code).toBe("SESSION_CREATION_LIMITED");

    const draft = { name: "Only trigger", side: "BUY", amount: "100", amountType: "USDC", maxSlippageBps: 50, expiresInHours: 24, conditions: [{ metric: "PRICE", operator: "LTE", target: "200" }] };
    expect((await limitedApp.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: draft })).statusCode).toBe(201);
    const overQuota = await limitedApp.inject({ method: "POST", url: "/api/ghosts", headers: { cookie: isolatedCookie }, payload: { ...draft, name: "One too many" } });
    expect(overQuota.statusCode).toBe(429);
    expect(overQuota.json().error.code).toBe("TRIGGER_QUOTA_REACHED");
    await limitedApp.close();
  });
});
