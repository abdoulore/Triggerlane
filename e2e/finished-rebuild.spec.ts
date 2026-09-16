import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The Finished tab merges three stored records: trades that settled, attempts
 * stopped at settlement, and triggers that ended without trading. Each opens
 * its own evidence in a pop-up.
 */

const blockedDraft = {
  name: "Finished Audit Trigger",
  side: "SELL",
  amount: "25",
  amountType: "POSITION_PERCENT",
  // A limit this tight can never fill, so settlement stores a blocked attempt.
  maxSlippageBps: 1,
  expiresInHours: 24,
  conditions: [{ metric: "PRICE", operator: "LTE", target: "999999" }],
};

async function ready(page: Page) {
  await page.goto("/ghosts");
  await expect(page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible({ timeout: 30_000 });
}

test("a cancelled trigger appears under Finished with its conditions", async ({ page }) => {
  await ready(page);

  const created = await page.evaluate(async (payload) => {
    const call = async (path: string, body?: unknown) => {
      // Only send a content-type when there is something to send.
      const headers: Record<string, string> = { "idempotency-key": crypto.randomUUID() };
      if (body != null) headers["content-type"] = "application/json";
      const response = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers,
        body: body == null ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
      return response.json();
    };
    const trigger = await call("/api/ghosts", payload) as { id: string };
    await call(`/api/ghosts/${trigger.id}/cancel`);
    return trigger;
  }, blockedDraft);

  expect(created.id).toBeTruthy();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Triggers", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Finished/ }).click();

  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Locked capital released").first()).toBeVisible();

  // The evidence stays behind the pop-up until it is asked for.
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Outcome", exact: true }).first().click();

  const dialog = page.getByRole("dialog", { name: "Outcome" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("SOL price").first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the Finished tab passes the accessibility gate with its pop-up open", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  await page.getByRole("button", { name: /^Finished/ }).click();

  const closed = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(closed.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  const evidence = page.getByRole("button", { name: /^(Receipt|Attempt|Outcome)$/ }).first();
  if (await evidence.count()) {
    await evidence.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const open = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(open.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  }
});

test("a trade stopped at settlement keeps its evidence", async ({ page }) => {
  await ready(page);

  // The price condition is always true and the limit is below any modeled
  // impact, so settlement stores a blocked attempt rather than a fill.
  const created = await page.evaluate(async () => {
    const call = async (path: string, body?: unknown) => {
      const headers: Record<string, string> = { "idempotency-key": crypto.randomUUID() };
      if (body != null) headers["content-type"] = "application/json";
      const response = await fetch(path, { method: "POST", credentials: "include", headers, body: body == null ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
      return response.json();
    };
    const trigger = await call("/api/ghosts", {
      name: "Blocked evidence trigger",
      side: "SELL",
      amount: "10",
      amountType: "POSITION_PERCENT",
      maxSlippageBps: 1,
      expiresInHours: 24,
      conditions: [{ metric: "PRICE", operator: "LTE", target: "999999" }],
    }) as { id: string };
    await call(`/api/ghosts/${trigger.id}/arm`);
    return trigger;
  });
  expect(created.id).toBeTruthy();

  // The worker settles on its own cadence, so wait for the attempt to land.
  await expect.poll(async () => page.evaluate(async () => {
    const workspace = await (await fetch("/api/workspace", { credentials: "include" })).json() as {
      executionAttempts: Array<{ ghostName: string }>;
    };
    return workspace.executionAttempts.some((attempt) => attempt.ghostName === "Blocked evidence trigger");
  }), { timeout: 60_000, intervals: [1_000] }).toBe(true);

  await page.goto("/ghosts?view=past");
  await expect(page.getByRole("button", { name: /^Finished/ })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  await expect(page.getByText("Blocked evidence trigger").first()).toBeVisible();
  await expect(page.getByText("Balances unchanged").first()).toBeVisible();

  await page.getByRole("button", { name: "Attempt", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Attempt" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Your limit")).toBeVisible();
  await expect(dialog.getByText("Locked capital")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

