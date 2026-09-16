import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The rebuilt trigger detail at /trigger2/[id], served alongside the current
 * /ghost/[id]. The page states the conditions and how far each is from firing;
 * the activity trail opens in a pop-up rather than sitting on the page.
 */

const draft = {
  name: "Detail watcher",
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

async function armedTrigger(page: Page) {
  // The Next.js dev-tools overlay renders in a portal above the page and
  // swallows clicks aimed at anything beneath it. It exists only in the dev
  // server this suite runs against. Removing the node does not hold, because
  // Next re-inserts it; a stylesheet rule does, whenever it reappears.
  await page.addStyleTag({ content: "nextjs-portal { pointer-events: none !important; }" }).catch(() => undefined);
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { pointer-events: none !important; }";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
  });

  // Load a rebuilt screen first so the session bootstrap has run.
  await page.goto("/triggers2");
  await expect(page.getByRole("button", { name: /Watching \(/ })).toBeVisible();
  const created = await page.evaluate(async (payload) => {
    const trigger = await (await fetch("/api/ghosts", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    })).json() as { id: string };
    await fetch(`/api/ghosts/${trigger.id}/arm`, {
      method: "POST",
      credentials: "include",
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    return trigger;
  }, draft);
  await page.goto(`/ghost/${created.id}`);
  await expect(page.getByText("Conditions", { exact: true })).toBeVisible();
  return created;
}

test("the rebuilt detail states each condition against its target", async ({ page }) => {
  await armedTrigger(page);

  await expect(page.getByText("WATCHING")).toBeVisible();
  // Funding moves, so how many conditions are met is not fixed. What must hold
  // is that the count is stated and the unreachable price condition is pending.
  await expect(page.getByText(/[0-9] of 2 conditions met/)).toBeVisible();

  await expect(page.getByText("SOL price")).toBeVisible();
  await expect(page.getByText("Funding", { exact: true })).toBeVisible();
  // Exact, or this also matches the "Est. price at 9,999.00" label.
  await expect(page.getByText("9,999.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending").first()).toBeVisible();
  await expect(page.getByText(/% away/).first()).toBeVisible();

  // The order facts are stated, not implied.
  await expect(page.getByText("Receive at target")).toBeVisible();
  await expect(page.getByText("Max slippage")).toBeVisible();
});

test("the activity trail opens in a pop-up and closes on Escape", async ({ page }) => {
  await armedTrigger(page);

  await page.getByRole("button", { name: /Activity \(/ }).click();
  const dialog = page.getByRole("dialog", { name: "Activity" });
  await expect(dialog).toBeVisible();
  // Arming records its own entries; the wording is the product's, not this test's.
  await expect(dialog.getByText("Time")).toBeVisible();
  await expect(dialog.getByText(/ARMED|WATCHING|CREATED/).first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the rebuilt detail passes the accessibility gate, pop-up included", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await armedTrigger(page);

  const closed = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(closed.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  await page.getByRole("button", { name: /Activity \(/ }).click();
  await expect(page.getByRole("dialog", { name: "Activity" })).toBeVisible();
  const open = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(open.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});
