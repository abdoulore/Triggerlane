import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The rebuilt Trade screen, served at /trade2 while the current one keeps
 * running. These assertions cover the decisions the design settled on, so a
 * regression in any of them is caught before the routes are swapped.
 */

test("the rebuilt Trade screen renders the market, the open triggers and the order rail", async ({ page }) => {
  await page.goto("/trade2");

  await expect(page.getByText("SOL-PERP")).toBeVisible();
  await expect(page.getByRole("group", { name: "Order side" })).toBeVisible();
  // Exact, or this also matches "Place buy trigger".
  await expect(page.getByRole("button", { name: "Buy", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Amount")).toHaveValue("1000");
  await expect(page.getByText("Trigger when all are true")).toBeVisible();
  await expect(page.getByRole("button", { name: /Place buy trigger/ })).toBeVisible();

  // Funding reads per hour, with the annual rate beside it.
  await expect(page.getByText(/%\s*APR/).first()).toBeVisible();

  // The form spells the operator out; chips keep the symbols.
  const operator = page.getByLabel("PRICE operator");
  await expect(operator).toBeVisible();
  await expect(operator).toHaveValue("LTE");
  await expect(operator.getByRole("option", { name: "Above" })).toBeAttached();
  await expect(operator.getByRole("option", { name: "Below" })).toBeAttached();
});

test("the order rail scrolls its middle while the action stays pinned", async ({ page }) => {
  await page.goto("/trade2");
  await expect(page.getByRole("button", { name: /Place buy trigger/ })).toBeVisible();

  // Three conditions is the most the domain allows, and the worst case for height.
  await page.getByRole("button", { name: "+ Funding" }).click();
  await page.getByRole("button", { name: "+ Position P&L" }).click();
  await expect(page.getByLabel("FUNDING target")).toBeVisible();
  await expect(page.getByLabel("PNL target")).toBeVisible();

  // The action is still reachable without scrolling the page.
  const action = page.getByRole("button", { name: /Place buy trigger/ });
  await expect(action).toBeInViewport();

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
});

test("the rebuilt Trade screen passes the accessibility gate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/trade2");
  await expect(page.getByText("SOL-PERP")).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(serious).toEqual([]);
});
