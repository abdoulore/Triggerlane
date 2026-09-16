import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The rebuilt Triggers screen at /triggers2, served alongside the current
 * /ghosts. One wide table: conditions as chips, distance to firing, locked
 * capital, state, and the actions that change it.
 */

const draft = {
  name: "Rebuild watcher",
  side: "SELL",
  amount: "25",
  amountType: "POSITION_PERCENT",
  maxSlippageBps: 60,
  expiresInHours: 24,
  conditions: [
    { metric: "PRICE", operator: "GTE", target: "9999" },
    { metric: "FUNDING", operator: "GTE", target: "0.00002" },
  ],
};

async function placeTrigger(page: import("@playwright/test").Page) {
  await page.goto("/triggers2");
  // Wait for the loaded screen, not the loading line. Playwright matches text
  // as a case-insensitive substring, so "Triggers" also matches "Loading
  // triggers…", and the session bootstrap would not have finished yet.
  await expect(page.getByRole("button", { name: /Watching \(/ })).toBeVisible();
  return page.evaluate(async (payload) => {
    const created = await (await fetch("/api/ghosts", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    })).json() as { id: string };
    await fetch(`/api/ghosts/${created.id}/arm`, {
      method: "POST",
      credentials: "include",
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    return created;
  }, draft);
}

test("the rebuilt Triggers screen lists what is watching and why", async ({ page }) => {
  await placeTrigger(page);
  await page.reload();

  await expect(page.getByRole("button", { name: /Watching \(/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Finished \(/ })).toBeVisible();

  // Conditions read as chips, with the symbols kept for scanning.
  await expect(page.getByText("price ≥ 9,999").first()).toBeVisible();
  await expect(page.getByText(/funding ≥ .*APR/).first()).toBeVisible();

  // Locked capital is stated, not implied.
  await expect(page.getByText("Locked capital")).toBeVisible();
  await expect(page.getByText("Watching", { exact: true }).first()).toBeVisible();
});

test("a watching trigger can be paused and resumed from the table", async ({ page }) => {
  await placeTrigger(page);
  await page.reload();

  await page.getByRole("button", { name: "Pause", exact: true }).first().click();
  await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Resume", exact: true }).first().click();
  await expect(page.getByText("Watching", { exact: true }).first()).toBeVisible();
});

test("the rebuilt Triggers screen passes the accessibility gate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await placeTrigger(page);
  await page.reload();
  await expect(page.getByRole("button", { name: /Watching \(/ })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});
