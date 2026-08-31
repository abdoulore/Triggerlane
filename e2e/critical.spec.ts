import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function openWatchingGhostDetail(page: Page) {
  await page.goto("/trade");
  if ((page.viewportSize()?.width ?? 1440) <= 680) await page.getByRole("button", { name: "BUILD A TRIGGER" }).click();
  await page.getByRole("button", { name: "SAVE TRIGGER" }).click();
  await page.goto("/ghosts");
  await page.getByTitle("Start Trigger").first().click();
  await expect(page.getByTitle("Pause Trigger").first()).toBeVisible();
  await page.getByTitle("Open Trigger").first().click();
  await expect(page).toHaveURL(/\/ghost\/[a-f0-9-]+$/);
}

async function seedGhostCommandCenter(page: Page) {
  await page.goto("/ghosts");
  await expect(page.getByRole("heading", { name: "Your triggers" })).toBeVisible();
  await page.evaluate(async () => {
    const base = "http://127.0.0.1:8787";
    const defaults = {
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
    const call = async (path: string, body?: unknown) => {
      const headers: Record<string, string> = { "idempotency-key": crypto.randomUUID() };
      if (body != null) headers["content-type"] = "application/json";
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        credentials: "include",
        headers,
        body: body == null ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const readyConditions = [
      { metric: "PRICE", operator: "GTE", target: "200" },
      { metric: "FUNDING", operator: "GTE", target: "0" },
      { metric: "PNL", operator: "GTE", target: "-0.1" },
    ];
    const settled = await call("/api/ghosts", { ...defaults, name: "Settled Exit", conditions: readyConditions });
    await call(`/api/ghosts/${settled.id}/arm`);
    await call("/api/demo/step");
    const near = await call("/api/ghosts", { ...defaults, name: "Near Ready", conditions: [{ metric: "PRICE", operator: "GTE", target: "280" }, { metric: "FUNDING", operator: "GTE", target: "0" }, { metric: "PNL", operator: "GTE", target: "1" }] });
    await call(`/api/ghosts/${near.id}/arm`);
    const paused = await call("/api/ghosts", { ...defaults, name: "Paused Guard", conditions: [{ metric: "PRICE", operator: "GTE", target: "999" }] });
    await call(`/api/ghosts/${paused.id}/arm`);
    await call(`/api/ghosts/${paused.id}/pause`);
    await call("/api/ghosts", { ...defaults, name: "Buy the Dip", side: "BUY", amount: "1000", amountType: "USDC" });
  });
  await page.reload();
  await expect(page.getByText("Near Ready", { exact: true }).first()).toBeVisible();
}

async function seedPortfolio(page: Page) {
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Your sandbox portfolio" })).toBeVisible();
  await page.evaluate(async () => {
    const base = "http://127.0.0.1:8787";
    const call = async (path: string, body?: unknown) => {
      const headers: Record<string, string> = { "idempotency-key": crypto.randomUUID() };
      if (body != null) headers["content-type"] = "application/json";
      const response = await fetch(`${base}${path}`, { method: "POST", credentials: "include", headers, body: body == null ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
      return response.json();
    };
    const baseDraft = {
      side: "SELL", amount: "25", amountType: "POSITION_PERCENT", maxSlippageBps: 50, expiresInHours: 24,
      conditions: [{ metric: "PRICE", operator: "GTE", target: "280" }, { metric: "FUNDING", operator: "GTE", target: "0.0005" }, { metric: "PNL", operator: "GTE", target: "0.1" }],
    };
    const settled = await call("/api/ghosts", { ...baseDraft, name: "Portfolio Rebalance", conditions: [{ metric: "PRICE", operator: "GTE", target: "1" }, { metric: "FUNDING", operator: "GTE", target: "-1" }, { metric: "PNL", operator: "GTE", target: "-1" }] });
    await call(`/api/ghosts/${settled.id}/arm`);
    await call("/api/demo/step");
    const watching = await call("/api/ghosts", { ...baseDraft, name: "Portfolio Guard" });
    await call(`/api/ghosts/${watching.id}/arm`);
  });
  await page.reload();
  await expect(page.getByText("Portfolio Guard", { exact: true })).toBeVisible();
}

async function seedHistoryAudit(page: Page) {
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Trigger history" })).toBeVisible();
  await page.evaluate(async () => {
    const base = "http://127.0.0.1:8787";
    const call = async (path: string, body?: unknown) => {
      const headers: Record<string, string> = { "idempotency-key": crypto.randomUUID() };
      if (body != null) headers["content-type"] = "application/json";
      const response = await fetch(`${base}${path}`, { method: "POST", credentials: "include", headers, body: body == null ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
      return response.json();
    };
    const conditions = [{ metric: "PRICE", operator: "GTE", target: "1" }, { metric: "FUNDING", operator: "GTE", target: "-1" }, { metric: "PNL", operator: "GTE", target: "-1" }];
    const draft = { side: "SELL", amount: "25", amountType: "POSITION_PERCENT", maxSlippageBps: 50, expiresInHours: 24, conditions };
    const filled = await call("/api/ghosts", { ...draft, name: "Settled Audit" });
    await call(`/api/ghosts/${filled.id}/arm`);
    await call("/api/demo/step");
    const blocked = await call("/api/ghosts", { ...draft, name: "Blocked Audit", maxSlippageBps: 1 });
    await call(`/api/ghosts/${blocked.id}/arm`);
    await call("/api/demo/step");
    const cancelled = await call("/api/ghosts", { ...draft, name: "Cancelled Audit", conditions: [{ metric: "PRICE", operator: "GTE", target: "999" }, { metric: "FUNDING", operator: "GTE", target: "1" }, { metric: "PNL", operator: "GTE", target: "1" }] });
    await call(`/api/ghosts/${cancelled.id}/arm`);
    await call(`/api/ghosts/${cancelled.id}/cancel`);
  });
  await page.reload();
  await expect(page.getByText("Blocked Audit", { exact: true })).toBeVisible();
}

test("landing teaches and renders a real 3D Ghost cycle", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "TRIGGERLANE", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /ENTER SANDBOX/ }).first()).toHaveAttribute("href", "/trade");
  const canvas = page.locator('canvas[data-scene="condition-lattice"]');
  await expect(canvas).toBeVisible();
  const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    if (!context) return 0;
    const sample = new Uint8Array(4 * 24 * 24);
    context.readPixels(0, 0, 24, 24, context.RGBA, context.UNSIGNED_BYTE, sample);
    return sample.reduce((total, value) => total + value, 0);
  });
  expect(pixels).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("triggerlane-hero-desktop.png"), fullPage: false });
  await page.getByRole("button", { name: /WATCH A TRIGGER/ }).click();
  await expect(page.getByText("Receipt generated", { exact: true })).toBeVisible({ timeout: 9_000 });
  await expect(page.getByText("FILLED AT $284.14 · 16 BPS")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("landing-desktop.png"), fullPage: false });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("landing remains framed and nonblank on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "TRIGGERLANE", exact: true })).toBeVisible();
  await expect(page.locator('canvas[data-scene="condition-lattice"]')).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await page.screenshot({ path: testInfo.outputPath("landing-mobile.png"), fullPage: false });
});

test("creates, arms, settles, and receipts one Ghost exactly once", async ({ page }) => {
  await page.goto("/trade");
  await expect(page.getByRole("heading", { name: "SOL / USDC" })).toBeVisible();
  await expect(page.getByText("DEMO FEED · EXECUTION ELIGIBLE")).toBeVisible();
  await expect(page.getByRole("region", { name: "Market signal status" })).toContainText("FRESHNESS");
  await expect(page.getByRole("region", { name: "Capital commitment preview" })).toContainText("10 SOL");
  await expect(page.getByLabel(/Trigger lifecycle:/)).toContainText("WATCHING");
  await expect(page.locator(".waiting-reason")).toBeVisible();

  await page.getByRole("button", { name: "SAVE TRIGGER" }).click();
  await expect(page.getByRole("button", { name: "START WATCHING" })).toBeVisible();
  await page.getByRole("button", { name: "START WATCHING" }).click();
  await expect(page.getByText("1 ACTIVE TRIGGERS")).toBeVisible();
  await expect(page.locator("#portfolio").getByText("$2,584.00", { exact: true })).toBeVisible();

  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "ADVANCE FEED" }).click();
  }

  await expect(page.getByRole("status").filter({ hasText: "TRIGGER FILLED" })).toBeVisible();
  await page.getByRole("button", { name: "ADVANCE FEED" }).click();
  await page.getByRole("link", { name: "History" }).click();

  const settlement = page.locator(".history-audit-row").filter({ hasText: "SOL profit lock" });
  await expect(settlement).toHaveCount(1);
  await settlement.click();
  await expect(page).toHaveURL(/item=receipt%3A/);
  await expect(page.getByRole("dialog", { name: /SOL profit lock filled audit record/i })).toBeVisible();
  await expect(page.getByText("CONDITION TIMELINE")).toBeVisible();
  await expect(page.getByText("SETTLEMENT TIMELINE")).toBeVisible();
  await expect(page.getByText("FRAME PROVENANCE")).toBeVisible();
  await expect(page.getByText("16 bps")).toBeVisible();
  await page.getByRole("button", { name: "Close receipt" }).click();
  await page.goto("/ghosts");
  await page.getByTitle("Open Trigger").first().click();
  await expect(page.getByRole("heading", { name: "One action, fully accounted for" })).toBeVisible();
  await expect(page.getByText("Quote model", { exact: true })).toBeVisible();
  await expect(page.getByText("Ledger transaction", { exact: true })).toBeVisible();
});

test("Ghost Detail renders a real data-driven 3D core and truthful lifecycle", async ({ page }, testInfo) => {
  await openWatchingGhostDetail(page);
  await expect(page.getByRole("heading", { name: /parts of the moment|has not reached|whole moment/i })).toBeVisible();
  await expect(page.getByRole("table", { name: "Exact condition observations" }).getByRole("row")).toHaveCount(1);
  await expect(page.getByText("Triggerlane Sandbox", { exact: true })).toBeVisible();

  const canvas = page.locator('canvas[data-scene="ghost-core"]');
  await expect(canvas).toBeVisible();
  const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    if (!context) return 0;
    const sample = new Uint8Array(4 * 28 * 28);
    context.readPixels(0, 0, 28, 28, context.RGBA, context.UNSIGNED_BYTE, sample);
    return sample.reduce((total, value) => total + value, 0);
  });
  expect(pixels).toBeGreaterThan(0);

  const lifecycle = page.getByRole("slider", { name: "Inspect trigger lifecycle" });
  await expect(lifecycle).toHaveAttribute("max", "1");
  await lifecycle.fill("0");
  await expect(page.getByText("Viewing DRAFT. Actual status is WATCHING.")).toBeVisible();
  await page.getByRole("button", { name: "WATCHING" }).click();
  await expect(page.getByText("Showing the current stored status: WATCHING.")).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("ghost-detail-desktop.png"), fullPage: false });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});

test("Ghost Detail keeps its 3D meaning and framing on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWatchingGhostDetail(page);
  const canvas = page.locator('canvas[data-scene="ghost-core"]');
  await expect(canvas).toBeVisible();
  const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    if (!context) return 0;
    const sample = new Uint8Array(4 * 24 * 24);
    context.readPixels(0, 0, 24, 24, context.RGBA, context.UNSIGNED_BYTE, sample);
    return sample.reduce((total, value) => total + value, 0);
  });
  expect(pixels).toBeGreaterThan(0);
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await page.screenshot({ path: testInfo.outputPath("ghost-detail-mobile.png"), fullPage: false });
});

test("Ghost Detail has a complete no-WebGL fallback", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return original.call(this, type as never, ...args as never);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await openWatchingGhostDetail(page);
  await expect(page.getByLabel(/Trigger visualization fallback/)).toBeVisible();
  await expect(page.locator(".fallback-nodes > div")).toHaveCount(1);
  await expect(page.getByText("OF 1 READY")).toBeVisible();
});

test("Live Data visibly refuses execution", async ({ page }) => {
  await page.goto("/trade");
  await page.getByRole("button", { name: "LIVE", exact: true }).click();
  await expect(page.getByText("LIVE DATA · MONITORING ONLY")).toBeVisible();
  await expect(page.getByRole("button", { name: "ADVANCE FEED" })).toBeDisabled();
});

test("Trade is legible, welcoming, and accessible on desktop", async ({ page }, testInfo) => {
  await page.goto("/trade");
  await expect(page.getByRole("heading", { name: "Choose the moment" })).toBeVisible();

  const typeSizes = await page.evaluate(() => {
    const size = (selector: string) => Number.parseFloat(getComputedStyle(document.querySelector(selector) as Element).fontSize);
    return {
      body: size("body"),
      marketTitle: size(".market-title h1"),
      composerTitle: size(".composer-panel .panel-heading h2"),
      composerIntro: size(".composer-intro"),
      fieldLabel: size(".field-label"),
      conditionLabel: size(".condition-cell-top"),
      waitingReason: size(".waiting-reason"),
    };
  });
  expect(typeSizes.body).toBeGreaterThanOrEqual(14);
  expect(typeSizes.marketTitle).toBeGreaterThanOrEqual(20);
  expect(typeSizes.composerTitle).toBeGreaterThanOrEqual(23);
  expect(typeSizes.composerIntro).toBeGreaterThanOrEqual(14);
  expect(typeSizes.fieldLabel).toBeGreaterThanOrEqual(12);
  expect(typeSizes.conditionLabel).toBeGreaterThanOrEqual(11);
  expect(typeSizes.waitingReason).toBeGreaterThanOrEqual(12);

  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await page.screenshot({ path: testInfo.outputPath("trade-legibility-desktop.png"), fullPage: false });

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious, serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
});

test("Composer supports one signal or an explicit combination", async ({ page }, testInfo) => {
  await page.goto("/trade");
  const price = page.getByLabel("Use SOL price condition");
  const funding = page.getByLabel("Use Perp funding condition");
  const pnl = page.getByLabel("Use Position P&L condition");
  await expect(price).toBeChecked();
  await expect(price).toBeDisabled();
  await expect(funding).not.toBeChecked();
  await expect(pnl).not.toBeChecked();
  await expect(page.getByLabel("FUNDING target")).toBeDisabled();
  await expect(page.getByText(/of 1 true now/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("composer-single-signal.png"), fullPage: false });

  await funding.check();
  await expect(price).toBeEnabled();
  await expect(page.getByLabel("FUNDING target")).toBeEnabled();
  await expect(page.getByText(/of 2 true now/)).toBeVisible();
  await price.uncheck();
  await expect(funding).toBeDisabled();
  await expect(page.getByText(/of 1 true now/)).toBeVisible();

  await page.getByRole("textbox", { name: "Trigger name" }).fill("Funding only exit");
  await page.getByRole("button", { name: /SAVE TRIGGER/ }).click();
  const saved = await page.evaluate(async () => {
    const ghosts = await (await fetch("http://127.0.0.1:8787/api/ghosts", { credentials: "include" })).json() as Array<{ name: string; conditions: Array<{ metric: string }> }>;
    return ghosts.find((ghost) => ghost.name === "Funding only exit")?.conditions.map((condition) => condition.metric);
  });
  expect(saved).toEqual(["FUNDING"]);
});

test("mobile monitoring does not overflow horizontally", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trade");
  await expect(page.getByRole("heading", { name: "SOL / USDC" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
});

test("Replay runs complete historical frames and exposes trigger inspection", async ({ page }) => {
  await page.goto("/trade");
  await page.getByRole("button", { name: "TRY PAST MARKET DATA" }).click();
  const dialog = page.getByRole("dialog", { name: /SOL profit lock historical Replay/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("7", { exact: true })).toBeVisible();
  await expect(dialog.getByText("42/42 COMPLETE FRAMES · DEMO PROVENANCE")).toBeVisible();
  await expect(dialog.getByText("Historical simulations do not predict future performance.")).toBeVisible();

  await dialog.getByRole("button", { name: "24H" }).click();
  await expect(dialog.getByText("24/24 COMPLETE FRAMES · DEMO PROVENANCE")).toBeVisible();
  await dialog.getByRole("button", { name: "Inspect trigger 1" }).click();
  await expect(dialog.getByText("TRIGGER", { exact: true })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include(".replay-modal").withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});

test("Discover explains, replays, and hands off a supported strategy without arming it", async ({ page }, testInfo) => {
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Start with a moment worth watching" })).toBeVisible();
  const beforeCount = await page.evaluate(async () => ((await (await fetch("http://127.0.0.1:8787/api/ghosts", { credentials: "include" })).json()) as unknown[]).length);
  const preview = page.locator("#strategy-preview");
  await expect(preview.getByRole("heading", { name: "Buy the Fear" })).toBeVisible();
  await expect(preview.getByText("ALL MUST BE TRUE IN ONE FRAME")).toBeVisible();
  await expect(preview.locator(".lattice-condition")).toHaveCount(3);
  await expect(preview.getByText("CAPITAL IF ARMED")).toBeVisible();
  await expect(preview.getByText("Loading creates an editable draft only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "PRICE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "FUNDING" })).toBeVisible();
  await expect(page.getByRole("button", { name: "POSITION P&L" })).toBeVisible();

  const typeSizes = await page.evaluate(() => ({
    title: Number.parseFloat(getComputedStyle(document.querySelector(".page-title h1") as Element).fontSize),
    intro: Number.parseFloat(getComputedStyle(document.querySelector(".page-title p") as Element).fontSize),
    strategy: Number.parseFloat(getComputedStyle(document.querySelector(".strategy-feature-copy h2") as Element).fontSize),
    body: Number.parseFloat(getComputedStyle(document.querySelector(".strategy-feature-copy > p") as Element).fontSize),
  }));
  expect(typeSizes.title).toBeGreaterThanOrEqual(40);
  expect(typeSizes.intro).toBeGreaterThanOrEqual(16);
  expect(typeSizes.strategy).toBeGreaterThanOrEqual(44);
  expect(typeSizes.body).toBeGreaterThanOrEqual(15);

  await preview.getByRole("button", { name: "REPLAY LAST 24H" }).click();
  const replay = page.getByRole("region", { name: "24 hour deterministic Replay result" });
  await expect(replay.getByText("24H DETERMINISTIC REPLAY")).toBeVisible();
  await expect(replay.getByText("FRAMES CHECKED")).toBeVisible();
  await expect(replay).toContainText("24");
  await expect(replay).toContainText("No order was created and no capital was reserved.");

  await page.getByRole("button", { name: /Downside Break/i }).click();
  await expect(preview.getByRole("heading", { name: "Downside Break" })).toBeVisible();
  await expect(preview.getByText("SELL SOL", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Advanced" }).click();
  const advanced = page.locator(".advanced-boundary");
  await expect(advanced.getByRole("heading", { name: "Advanced signals need qualified data first" })).toBeVisible();
  await expect(advanced).toContainText("LIQUIDITY · UNSUPPORTED");
  await expect(advanced).toContainText("TVL · UNSUPPORTED");
  await expect(advanced).toContainText("VOLUME · UNSUPPORTED");
  await page.getByRole("tab", { name: "Popular" }).click();
  await page.getByRole("button", { name: /Euphoria Exit/i }).click();
  await expect(preview.getByRole("heading", { name: "Euphoria Exit" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("discover-editorial-desktop.png"), fullPage: true });

  await preview.getByRole("button", { name: "LOAD INTO COMPOSER FOR REVIEW" }).click();
  await expect(page).toHaveURL(/\/trade\?strategy=euphoria-exit$/);
  await expect(page.getByText("STRATEGY LOADED")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Trigger name" })).toHaveValue("Euphoria Exit");
  await expect(page.getByRole("button", { name: "SELL" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("spinbutton", { name: "SOL position to sell %" })).toHaveValue("25");
  await expect(page.getByRole("button", { name: /SAVE TRIGGER/ })).toBeVisible();

  const afterCount = await page.evaluate(async () => ((await (await fetch("http://127.0.0.1:8787/api/ghosts", { credentials: "include" })).json()) as unknown[]).length);
  expect(afterCount).toBe(beforeCount);

  await page.goto("/discover");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});

test("Discover remains composed on a phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Start with a moment worth watching" })).toBeVisible();
  await expect(page.locator("#strategy-preview").getByRole("heading", { name: "Buy the Fear" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await page.screenshot({ path: testInfo.outputPath("discover-editorial-mobile.png"), fullPage: true });
});

test("Ghosts and History keep the welcoming reading hierarchy", async ({ page }) => {
  for (const [path, title] of [["/ghosts", "Your triggers"], ["/history", "Trigger history"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const typeSizes = await page.evaluate(() => ({
      title: Number.parseFloat(getComputedStyle(document.querySelector(".page-title h1") as Element).fontSize),
      intro: Number.parseFloat(getComputedStyle(document.querySelector(".page-title p") as Element).fontSize),
    }));
    expect(typeSizes.title).toBeGreaterThanOrEqual(40);
    expect(typeSizes.intro).toBeGreaterThanOrEqual(16);
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  }
});

test("History distinguishes settlements, blocked attempts, and stopped Ghosts", async ({ page }, testInfo) => {
  await seedHistoryAudit(page);
  await expect(page.locator(".history-audit-row")).toHaveCount(3);
  await expect(page.locator(".history-summary").getByRole("button", { name: /FILLED 1/ })).toBeVisible();
  await expect(page.locator(".history-summary").getByRole("button", { name: /BLOCKED 1/ })).toBeVisible();
  await expect(page.locator(".history-summary").getByRole("button", { name: /CANCELLED 1/ })).toBeVisible();

  await page.getByPlaceholder("Trigger or outcome").fill("Blocked");
  await expect(page.locator(".history-audit-row")).toHaveCount(1);
  await page.getByRole("button", { name: /Blocked Audit/ }).click();
  await expect(page).toHaveURL(/item=attempt%3A/);
  const blocked = page.getByRole("dialog", { name: "Blocked Audit blocked audit record" });
  await expect(blocked).toContainText("Conditions qualified. Settlement was prevented.");
  await expect(blocked).toContainText("No ledger transaction");
  await expect(blocked).toContainText("Owned balances did not change");
  await page.screenshot({ path: testInfo.outputPath("history-blocked-audit-desktop.png"), fullPage: false });
  await page.getByTitle("Close audit record").click();
  await expect(page.getByPlaceholder("Trigger or outcome")).toHaveValue("Blocked");
  await expect(page.locator(".history-audit-row")).toHaveCount(1);
  await page.getByRole("button", { name: /Blocked Audit/ }).click();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Blocked Audit blocked audit record" })).toBeVisible();
  await page.getByTitle("Close audit record").click();
  await expect(page).not.toHaveURL(/item=/);

  await page.getByPlaceholder("Trigger or outcome").fill("");
  await page.getByRole("button", { name: /Settled Audit/ }).click();
  await expect(page).toHaveURL(/item=receipt%3A/);
  const receipt = page.getByRole("dialog", { name: "Settled Audit filled audit record" });
  await expect(receipt).toContainText("CONDITION TIMELINE");
  await expect(receipt).toContainText("SETTLEMENT TIMELINE");
  await expect(receipt).toContainText("FRAME PROVENANCE");
  await expect(receipt).toContainText("Ledger transaction");
  await page.screenshot({ path: testInfo.outputPath("history-receipt-desktop.png"), fullPage: false });
  const receiptAccessibility = await new AxeBuilder({ page }).include(".audit-modal").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(receiptAccessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  await page.reload();
  await expect(receipt).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await receipt.getByRole("button", { name: "DOWNLOAD JSON" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^ghost-receipt-.*\.json$/);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".printable-audit")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.keyboard.press("Escape");
  await expect(receipt).toBeHidden();
  const executionCount = await page.evaluate(async () => (await (await fetch("http://127.0.0.1:8787/api/workspace", { credentials: "include" })).json()).executions.length);
  expect(executionCount).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("history-audit-desktop.png"), fullPage: true });

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});

test("History audit records remain usable on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedHistoryAudit(page);
  await page.getByRole("button", { name: /Blocked Audit/ }).click();
  await expect(page.getByText("Conditions qualified. Settlement was prevented.")).toBeVisible();
  await page.waitForTimeout(300);
  let dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await page.screenshot({ path: testInfo.outputPath("history-audit-mobile.png"), fullPage: false });
  await page.getByTitle("Close audit record").click();
  await page.getByRole("button", { name: /Settled Audit/ }).click();
  await expect(page.getByText("SIMULATED EXECUTION RECEIPT")).toBeVisible();
  await page.waitForTimeout(300);
  dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
});

test("Ghost command center makes state, distance, capital, and actions scannable", async ({ page }, testInfo) => {
  await seedGhostCommandCenter(page);
  await expect(page.getByRole("heading", { name: "Watching now" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Paused safely" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready to start" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finished" })).toBeVisible();
  await expect(page.locator(".closest-ghost")).toContainText("Near Ready");
  await expect(page.locator(".ghost-signal-trace")).toHaveCount(4);
  await expect(page.getByTitle("Start unavailable while status is WATCHING")).toBeDisabled();

  const nearRow = page.locator(".ghost-command-row").filter({ hasText: "Near Ready" });
  await nearRow.getByTitle("Pause Trigger").click();
  await expect(page.locator(".state-paused")).toContainText("Near Ready");

  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(page.getByText("Buy the Dip", { exact: true })).toBeVisible();
  await expect(page.locator(".ghost-state-bands").getByText("Near Ready", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "All states" }).click();
  await page.locator(".ghost-command-controls").getByLabel("Action").selectOption("BUY");
  await expect(page.getByText("Buy the Dip", { exact: true })).toBeVisible();
  await expect(page.locator(".ghost-state-bands").getByText("Settled Exit", { exact: true })).toHaveCount(0);
  await page.locator(".ghost-command-controls").getByLabel("Action").selectOption("ALL");
  await page.getByPlaceholder("Name or waiting reason").fill("does not exist");
  await expect(page.getByRole("heading", { name: "No triggers match these filters" })).toBeVisible();
  await page.getByRole("button", { name: "SHOW ALL TRIGGERS" }).click();
  await expect(page.getByText("Near Ready", { exact: true }).first()).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("ghost-command-center-desktop.png"), fullPage: false });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});

test("Ghost command center remains usable on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedGhostCommandCenter(page);
  await expect(page.locator(".closest-ghost")).toContainText("Near Ready");
  await expect(page.getByRole("button", { name: "All states" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await page.screenshot({ path: testInfo.outputPath("ghost-command-center-mobile.png"), fullPage: false });
});

test("Ghost command center paginates large lists", async ({ page }) => {
  await page.goto("/ghosts");
  await expect(page.getByRole("heading", { name: "Your triggers" })).toBeVisible();
  await page.evaluate(async () => {
    const draft = {
      side: "SELL", amount: "10", amountType: "POSITION_PERCENT", maxSlippageBps: 50, expiresInHours: 24,
      conditions: [{ metric: "PRICE", operator: "GTE", target: "280" }, { metric: "FUNDING", operator: "GTE", target: "0.0005" }, { metric: "PNL", operator: "GTE", target: "0.1" }],
    };
    for (let index = 1; index <= 25; index += 1) {
      const response = await fetch("http://127.0.0.1:8787/api/ghosts", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ ...draft, name: `Scale Ghost ${String(index).padStart(2, "0")}` }) });
      if (!response.ok) throw new Error(await response.text());
    }
  });
  await page.reload();
  await expect(page.getByText("Showing 1-24 of 25")).toBeVisible();
  await page.getByTitle("Next page").click();
  await expect(page.getByText("PAGE 2 OF 2")).toBeVisible();
  await expect(page.getByText("Showing 25-25 of 25")).toBeVisible();
});

test("Portfolio reconciles capital, reservations, previews, and ledger sources", async ({ page }, testInfo) => {
  await seedPortfolio(page);
  await expect(page.getByText("LEDGER RECONCILED")).toBeVisible();
  await expect(page.getByText("EXACT MATCH")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where every simulated dollar sits" })).toBeVisible();
  const reservation = page.locator(".reservation-row").filter({ hasText: "Portfolio Guard" });
  await expect(reservation).toContainText("CONTROLLED NOW");
  await expect(reservation).toContainText("IF IT EXECUTED NOW");
  await expect(page.locator(".ledger-row")).toHaveCount(2);
  await expect(page.getByText("Portfolio Rebalance", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "SOL", exact: true }).click();
  await expect(page.locator(".ledger-row")).toHaveCount(2);
  await page.getByRole("button", { name: "USDC", exact: true }).click();
  await expect(page.locator(".ledger-row")).toHaveCount(2);
  await page.getByTitle("Inspect Portfolio Guard").click();
  await expect(page).toHaveURL(/\/ghost\/[a-f0-9-]+$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Your sandbox portfolio" })).toBeVisible();
  await expect(page.getByText("LEDGER RECONCILED")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("portfolio-desktop.png"), fullPage: true });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});

test("Portfolio preserves capital hierarchy without mobile overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPortfolio(page);
  await expect(page.getByText("TOTAL SIMULATED EQUITY")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByText("Portfolio", { exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  await page.screenshot({ path: testInfo.outputPath("portfolio-mobile.png"), fullPage: false });
});

test("AI Composer requires review before applying a structured Ghost", async ({ page }) => {
  await page.goto("/trade");
  await page.getByRole("tab", { name: "AI", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Describe your trigger" })).toBeVisible();
  await page.getByRole("button", { name: "GENERATE TRIGGER" }).click();

  await expect(page.getByText("STRUCTURED PROPOSAL")).toBeVisible();
  await expect(page.getByText("Amount: 50% of the SOL position")).toBeVisible();
  await expect(page.getByText("Triggerlane analyzes configuration and historical conditions. It does not provide investment advice.")).toBeVisible();
  await expect(page.getByRole("button", { name: "SAVE TRIGGER" })).toHaveCount(0);

  await page.getByRole("button", { name: "APPLY TO COMPOSER" }).click();
  await expect(page.getByText("AI DRAFT APPLIED")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Trigger name" })).toHaveValue("AI SOL exit");
  await expect(page.getByRole("spinbutton", { name: "SOL position to sell %" })).toHaveValue("50");
  await expect(page.getByLabel("PRICE target")).toHaveValue("300");
  await expect(page.getByLabel("FUNDING target")).toHaveValue("0.05");
  await expect(page.getByLabel("PNL target")).toHaveValue("40");
  await expect(page.getByRole("button", { name: "SAVE TRIGGER" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include(".composer-panel").withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});

test("connection drawer reports real system capability and closes with Escape", async ({ page }) => {
  await page.goto("/trade");
  await page.getByRole("button", { name: "DEMO EXECUTION" }).click();
  const drawer = page.getByRole("dialog", { name: "Connections" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("PRICE FEED")).toBeVisible();
  await expect(drawer.getByText("FUNDING FEED")).toBeVisible();
  await expect(drawer.getByText("TRIGGER ENGINE")).toBeVisible();
  await expect(drawer.getByText("SANDBOX EXECUTION")).toBeVisible();
  await expect(drawer.getByText("Rialo remains unavailable and is not reported as connected.")).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include(".connection-drawer").withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("mobile prioritizes monitoring and opens Composer as a focused sheet", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trade");
  const nav = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(nav).toBeVisible();
  await expect(page.getByRole("region", { name: "Market signal status" })).toBeVisible();
  await expect(nav.getByText("Portfolio", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "BUILD A TRIGGER" }).click();
  await expect(page.getByRole("heading", { name: "Choose the moment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Composer" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  const mobileType = await page.evaluate(() => ({
    title: Number.parseFloat(getComputedStyle(document.querySelector(".composer-panel .panel-heading h2") as Element).fontSize),
    intro: Number.parseFloat(getComputedStyle(document.querySelector(".composer-intro") as Element).fontSize),
    fieldLabel: Number.parseFloat(getComputedStyle(document.querySelector(".field-label") as Element).fontSize),
  }));
  expect(mobileType.title).toBeGreaterThanOrEqual(23);
  expect(mobileType.intro).toBeGreaterThanOrEqual(14);
  expect(mobileType.fieldLabel).toBeGreaterThanOrEqual(12);
  await page.screenshot({ path: testInfo.outputPath("trade-legibility-mobile.png"), fullPage: false });
  await page.getByRole("button", { name: "Close Composer" }).click();
  await expect(page.getByRole("heading", { name: "Choose the moment" })).toBeHidden();
});
