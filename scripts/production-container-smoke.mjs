import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const engine = process.env.CONTAINER_ENGINE ?? "docker";
const image = `triggerlane-release-smoke:${Date.now()}`;
const container = `triggerlane-release-${Date.now()}`;
const volume = `triggerlane-release-data-${Date.now()}`;
const base = "http://127.0.0.1:34100";
const secret = "container-release-session-secret-at-least-32-characters";
let cookie = "";

const run = (...args) => execFileSync(engine, args, { stdio: "inherit" });
const cleanup = () => {
  try { run("rm", "-f", container); } catch {}
  try { run("volume", "rm", volume); } catch {}
  try { run("image", "rm", image); } catch {}
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = async (path, options = {}) => {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${text}`);
  return { response, body: text ? JSON.parse(text) : null, setCookie };
};
const mutation = (path, body) => request(path, {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
  body: body == null ? undefined : JSON.stringify(body),
});
const start = () => run("run", "-d", "--name", container, "-p", "34100:3000", "-v", `${volume}:/data`,
  "-e", "NODE_ENV=production", "-e", `SESSION_SECRET=${secret}`, "-e", "PGLITE_DATA_DIR=/data/triggerlane",
  "-e", "API_HOST=127.0.0.1", "-e", "API_PORT=8787", "-e", "API_INTERNAL_URL=http://127.0.0.1:8787", image);
const stop = () => run("rm", "-f", container);
const ready = async () => {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try { const result = await request("/health/ready"); if (result.body?.status === "ready") return; } catch {}
    await sleep(1_000);
  }
  run("logs", container);
  throw new Error("Production container did not become ready.");
};

try {
  execFileSync(engine, ["version"], { stdio: "ignore" });
  run("build", "-t", image, ".");
  run("volume", "create", volume);
  start();
  await ready();

  const session = await request("/api/session/anonymous", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initialMode: "DEMO" }) });
  if (!/HttpOnly/i.test(session.setCookie ?? "") || !/Secure/i.test(session.setCookie ?? "") || !/SameSite=Lax/i.test(session.setCookie ?? "")) {
    throw new Error("Production session cookie is missing HttpOnly, Secure, or SameSite=Lax.");
  }
  const created = await mutation("/api/ghosts", {
    name: "Container Persistence Receipt", side: "SELL", amount: "25", amountType: "POSITION_PERCENT",
    maxSlippageBps: 50, expiresInHours: 24,
    conditions: [{ metric: "PRICE", operator: "GTE", target: "1" }],
  });
  await mutation(`/api/ghosts/${created.body.id}/arm`);
  const before = await request("/api/workspace");
  if (!before.body.ghosts.some((item) => item.id === created.body.id && item.status === "WATCHING")) throw new Error("Armed trigger was not persisted before restart.");
  if (!before.body.reservations.some((item) => item.ghostId === created.body.id || item.ghost_id === created.body.id)) throw new Error("Reservation was not created.");

  stop(); start(); await ready();
  const restoredSession = await request("/api/session");
  if (restoredSession.body.userId !== session.body.userId) throw new Error("Session did not survive restart.");
  await mutation("/api/demo/step");
  const settled = await request("/api/workspace");
  const trigger = settled.body.ghosts.find((item) => item.id === created.body.id);
  if (trigger?.status !== "FILLED") throw new Error(`Expected FILLED after restart, received ${trigger?.status ?? "missing"}.`);
  if (!settled.body.executions.some((item) => item.ghostId === created.body.id || item.ghost_id === created.body.id)) throw new Error("Receipt was not generated.");

  stop(); start(); await ready();
  const finalState = await request("/api/workspace");
  if (!finalState.body.executions.some((item) => item.ghostId === created.body.id || item.ghost_id === created.body.id)) throw new Error("Receipt did not survive redeploy restart.");
  console.log("Production container release smoke passed: same-origin readiness, secure cookie, session, trigger, reservation, settlement, and receipt persistence.");
} finally {
  cleanup();
}
