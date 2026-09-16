import { expect, test } from "@playwright/test";

/**
 * The promise the whole product rests on: a trigger waits, settles once when
 * every condition is true together, and leaves a receipt that says what
 * happened. The launch suite proved this by driving the old composer and the
 * old audit view. It is proved here on the rebuilt screens.
 *
 * The guided scenario walks price 246.00 -> 288.10 and funding 0.00031 ->
 * 0.00058 over six frames, and stepping it settles inside the same transaction
 * that assembles the frame, so nothing here waits on a background worker.
 */

const DRAFT = {
  name: "Lifecycle profit lock",
  side: "SELL",
  amount: "25",
  amountType: "POSITION_PERCENT",
  maxSlippageBps: 100,
  expiresInHours: 24,
  // Both are reached partway through the guided walk, never on the first frame.
  conditions: [
    { metric: "PRICE", operator: "GTE", target: "280" },
    { metric: "FUNDING", operator: "GTE", target: "0.0005" },
  ],
};

test.beforeEach(async ({ page }) => {
  // initialMode is honoured only when the session is created, so the very first
  // bootstrap has to ask for DEMO. A later call returns the session unchanged.
  await page.route("**/api/session/anonymous", async (route) => {
    const request = route.request();
    await route.continue({
      headers: { ...request.headers(), "content-type": "application/json" },
      postData: JSON.stringify({ initialMode: "DEMO" }),
    });
  });
});

test("a trigger waits, settles once, and leaves a receipt", async ({ page }) => {
  await page.goto("/ghosts");
  await expect(page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible({ timeout: 30_000 });

  // Place it through the API so this test is about the lifecycle, not the form.
  const created = await page.evaluate(async (payload) => {
    const call = async (path: string, body?: unknown) => {
      const headers: Record<string, string> = { "idempotency-key": crypto.randomUUID() };
      if (body != null) headers["content-type"] = "application/json";
      const response = await fetch(path, { method: "POST", credentials: "include", headers, body: body == null ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
      return response.json();
    };
    const trigger = await call("/api/ghosts", payload) as { id: string };
    await call(`/api/ghosts/${trigger.id}/arm`);
    return trigger;
  }, DRAFT);

  // It waits: watching, with capital locked and nothing settled.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Lifecycle profit lock").first()).toBeVisible();
  await expect(page.getByText("Watching").first()).toBeVisible();

  // Walk the guided scenario until the conditions agree on one frame.
  const settled = await page.evaluate(async (id) => {
    for (let step = 0; step < 8; step += 1) {
      const current = await (await fetch(`/api/ghosts/${id}`, { credentials: "include" })).json() as { status: string };
      if (current.status === "FILLED") return { status: current.status, steps: step };
      await fetch("/api/demo/step", {
        method: "POST",
        credentials: "include",
        headers: { "idempotency-key": crypto.randomUUID() },
      });
    }
    const final = await (await fetch(`/api/ghosts/${id}`, { credentials: "include" })).json() as { status: string };
    return { status: final.status, steps: 8 };
  }, created.id);

  expect(settled.status, "the trigger never settled during the guided walk").toBe("FILLED");
  expect(settled.steps, "it settled on the first frame, so it was never really waiting").toBeGreaterThan(0);

  // Settled exactly once: one execution, and it cannot fire again.
  const executions = await page.evaluate(async () => {
    const workspace = await (await fetch("/api/workspace", { credentials: "include" })).json() as {
      executions: Array<{ ghost_name: string; status: string }>;
    };
    return workspace.executions.filter((execution) => execution.ghost_name === "Lifecycle profit lock");
  });
  expect(executions, "a settled trigger must produce exactly one execution").toHaveLength(1);

  // And it says so, in the finished list, with its receipt.
  await page.goto("/ghosts?view=past");
  await expect(page.getByRole("button", { name: /^Finished/ })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });

  const row = page.getByText("Lifecycle profit lock").first();
  await expect(row).toBeVisible();
  await expect(page.getByText("Filled").first()).toBeVisible();
  await expect(page.getByText("Committed to ledger").first()).toBeVisible();

  await page.getByRole("button", { name: "Receipt", exact: true }).first().click();
  const receipt = page.getByRole("dialog", { name: "Receipt" });
  await expect(receipt).toBeVisible();

  // The receipt has to state what actually moved and what it cost.
  await expect(receipt.getByText("Settled")).toBeVisible();
  await expect(receipt.getByText("Received")).toBeVisible();
  await expect(receipt.getByText("Execution price")).toBeVisible();
  await expect(receipt.getByText("Modeled slippage")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(receipt).toBeHidden();
});

test("a settled trigger is gone from the watching list", async ({ page }) => {
  await page.goto("/ghosts");
  await expect(page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible({ timeout: 30_000 });

  const created = await page.evaluate(async (payload) => {
    const call = async (path: string, body?: unknown) => {
      const headers: Record<string, string> = { "idempotency-key": crypto.randomUUID() };
      if (body != null) headers["content-type"] = "application/json";
      const response = await fetch(path, { method: "POST", credentials: "include", headers, body: body == null ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
      return response.json();
    };
    const trigger = await call("/api/ghosts", { ...payload, name: "Lifecycle disappearance" }) as { id: string };
    await call(`/api/ghosts/${trigger.id}/arm`);
    for (let step = 0; step < 8; step += 1) {
      const current = await (await fetch(`/api/ghosts/${trigger.id}`, { credentials: "include" })).json() as { status: string };
      if (current.status === "FILLED") break;
      await fetch("/api/demo/step", { method: "POST", credentials: "include", headers: { "idempotency-key": crypto.randomUUID() } });
    }
    return trigger;
  }, DRAFT);

  expect(created.id).toBeTruthy();

  await page.goto("/ghosts");
  await expect(page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Watching/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Lifecycle disappearance")).toHaveCount(0);

  await page.getByRole("button", { name: /^Finished/ }).click();
  await expect(page.getByText("Lifecycle disappearance").first()).toBeVisible();
});
