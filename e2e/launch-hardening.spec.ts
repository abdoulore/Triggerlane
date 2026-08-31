import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const productPages = [
  { path: "/trade", heading: /^SOL \/ USDC$/ },
  { path: "/ghosts", heading: "Your triggers" },
  { path: "/portfolio", heading: "Your sandbox portfolio" },
  { path: "/history", heading: "Trigger history" },
  { path: "/discover", heading: "Start with a moment worth watching" },
] as const;

const draft = {
  name: "Launch Audit Ghost",
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
};

async function createGhost(page: Page) {
  await page.goto("/trade");
  await expect(page.getByRole("heading", { name: "Choose the moment" })).toBeVisible();
  return page.evaluate(async (payload) => {
    const response = await fetch("http://127.0.0.1:8787/api/ghosts", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    });
    return response.json() as Promise<{ id: string }>;
  }, draft);
}

async function seriousAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`visual launch audit at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const item of productPages) {
      await page.goto(item.path);
      await expect(page.getByRole("heading", { name: item.heading })).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      expect(width.document, `${item.path} overflows at ${viewport.name}`).toBeLessThanOrEqual(width.viewport);
      await page.screenshot({ path: testInfo.outputPath(`${item.path.slice(1)}-${viewport.name}.png`), fullPage: true, animations: "disabled" });
    }
  });
}

test("every public and product page passes the launch accessibility gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "TRIGGERLANE", exact: true })).toBeVisible();
  expect(await seriousAxeViolations(page)).toEqual([]);

  for (const item of productPages) {
    await page.goto(item.path);
    await expect(page.getByRole("heading", { name: item.heading })).toBeVisible();
    expect(await seriousAxeViolations(page), `${item.path} has serious accessibility violations`).toEqual([]);
  }

  const ghost = await createGhost(page);
  await page.goto(`/ghost/${ghost.id}`);
  await expect(page.getByRole("heading", { name: ghost.id ? draft.name : "" })).toBeVisible();
  expect(await seriousAxeViolations(page)).toEqual([]);
});

test("reduced motion keeps both 3D explanations meaningful and still", async ({ page }) => {
  const sample = (selector: string) => page.locator(selector).evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    if (!context) return [];
    const pixels = new Uint8Array(4 * 12 * 12);
    context.readPixels(0, 0, 12, 12, context.RGBA, context.UNSIGNED_BYTE, pixels);
    return Array.from(pixels);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const landing = page.locator('canvas[data-scene="condition-lattice"]');
  await expect(landing).toBeVisible();
  const firstLanding = await sample('canvas[data-scene="condition-lattice"]');
  await page.waitForTimeout(700);
  expect(await sample('canvas[data-scene="condition-lattice"]')).toEqual(firstLanding);

  const ghost = await createGhost(page);
  await page.goto(`/ghost/${ghost.id}`);
  const core = page.locator('canvas[data-scene="ghost-core"]');
  await expect(core).toBeVisible();
  const firstCore = await sample('canvas[data-scene="ghost-core"]');
  await page.waitForTimeout(700);
  expect(await sample('canvas[data-scene="ghost-core"]')).toEqual(firstCore);
});

test("landing has a complete no-WebGL explanation", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return original.call(this, type as never, ...args as never);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/");
  await expect(page.getByLabel("Three market conditions converging into one execution")).toBeVisible();
  await expect(page.getByText("EXECUTE", { exact: true }).first()).toBeVisible();
});

test("loading, error, empty, unavailable, and terminal explanations stay explicit", async ({ page }) => {
  let releaseWorkspace: (() => void) | undefined;
  const workspaceGate = new Promise<void>((resolve) => { releaseWorkspace = resolve; });
  await page.route("**/api/workspace", async (route) => { await workspaceGate; await route.continue(); });
  await page.goto("/trade");
  await expect(page.getByRole("status", { name: "Loading Triggerlane workspace" })).toBeVisible();
  releaseWorkspace?.();
  await expect(page.getByRole("heading", { name: "Choose the moment" })).toBeVisible();
  await page.unroute("**/api/workspace");

  await page.route("**/api/workspace", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "AUDIT_FAILURE", message: "Launch audit outage" } }) }));
  await page.goto("/trade");
  await expect(page.getByRole("heading", { name: "Sandbox unavailable" })).toBeVisible();
  await expect(page.getByText("No capital was moved.")).toBeVisible();
  await page.unroute("**/api/workspace");

  await page.goto("/ghosts");
  await expect(page.getByRole("heading", { name: "Your first trigger starts with a moment" })).toBeVisible();
  await page.goto("/discover");
  await page.getByRole("tab", { name: "Advanced" }).click();
  await expect(page.getByText("LIQUIDITY · UNSUPPORTED")).toBeVisible();
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "No outcomes have been recorded" })).toBeVisible();
});

test("first-time comprehension and honesty gate covers the ten product questions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/OBSERVING · SOL \/ USDC/).first()).toBeVisible();
  await expect(page.getByText(/Triggerlane watches the market conditions/i).first()).toBeVisible();
  await expect(page.getByText(/simulated capital/i).first()).toBeVisible();

  await page.goto("/trade");
  await expect(page.getByText("PRICE", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("FUNDING", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("POSITION P&L", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/acts when every active condition is true/i)).toBeVisible();
  await expect(page.getByText(/capital/i).first()).toBeVisible();
  await expect(page.getByText(/DEMO FEED/i).first()).toBeVisible();
  await expect(page.getByText(/RIALO TARGET · NOT CONFIGURED/i).first()).toBeVisible();

  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/RIALO\s+(CONNECTED|LIVE|DEPLOYED)/i);
  expect(text).not.toMatch(/REAL (FUNDS|ASSETS) (MOVED|TRADED|EXECUTED)/i);
});

test("core routes stay inside interaction and navigation budgets", async ({ page }) => {
  for (const item of [{ path: "/", heading: /^TRIGGERLANE$/ }, ...productPages]) {
    const started = Date.now();
    await page.goto(item.path);
    await expect(page.getByRole("heading", { name: item.heading })).toBeVisible();
    const interactiveMs = Date.now() - started;
    const timing = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return { domContentLoadedMs: navigation.domContentLoadedEventEnd, responseMs: navigation.responseEnd };
    });
    expect(interactiveMs, `${item.path} interactive budget`).toBeLessThan(5_000);
    expect(timing.domContentLoadedMs, `${item.path} DOM budget`).toBeLessThan(3_000);
    expect(timing.responseMs, `${item.path} response budget`).toBeLessThan(1_500);
  }
});
