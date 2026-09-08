import { strict as assert } from "node:assert";
import { performance } from "node:perf_hooks";

process.env.NODE_ENV = "test";
const [{ createDatabase }, { buildServer }] = await Promise.all([import("../apps/api/src/db.ts"), import("../apps/api/src/server.ts")]);
const database = await createDatabase(":memory:");

try {
  const ipApp = await buildServer(database, { requestsPerIpPerMinute: 300 });
  const started = performance.now();
  const responses = await Promise.all(Array.from({ length: 340 }, () => ipApp.inject({ method: "GET", url: "/api/capabilities" })));
  const elapsedMs = performance.now() - started;
  assert.equal(responses.filter((response) => response.statusCode === 200).length, 300);
  assert.equal(responses.filter((response) => response.statusCode === 429).length, 40);
  assert.ok(responses.find((response) => response.statusCode === 429)?.headers["retry-after"]);
  await ipApp.close();

  const mutationApp = await buildServer(database, { requestsPerIpPerMinute: 100, mutationsPerSessionPerMinute: 10 });
  const session = await mutationApp.inject({ method: "POST", url: "/api/session/anonymous", payload: { initialMode: "DEMO" } });
  const rawCookie = session.headers["set-cookie"]!;
  const cookie = Array.isArray(rawCookie) ? rawCookie[0]! : rawCookie;
  const mutations = await Promise.all(Array.from({ length: 12 }, () => mutationApp.inject({ method: "POST", url: "/api/compiler/preview", headers: { cookie }, payload: {} })));
  assert.equal(mutations.filter((response) => response.statusCode === 422).length, 10);
  assert.equal(mutations.filter((response) => response.statusCode === 429).length, 2);
  await mutationApp.close();
  console.log(`Bounded-load probe passed: 340 concurrent reads in ${elapsedMs.toFixed(1)}ms; 300 accepted, 40 controlled 429 responses; mutation cap accepted 10 and rejected 2.`);
} finally {
  await database.close();
}
