import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The rebuilt Portfolio screen, now serving /portfolio. It states equity and
 * what is locked, and keeps the ledger behind a pop-up rather than on the page.
 */

test("the rebuilt Portfolio states equity, balances and what is locked", async ({ page }) => {
  await page.goto("/portfolio");

  // Wait on the heading, not on text that also appears while loading.
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText("Balances", { exact: true })).toBeVisible();
  await expect(page.getByText("Locked by triggers", { exact: true }).first()).toBeVisible();

  // The seeded account holds 40 SOL and 15,000 USDC.
  await expect(page.getByText("SOL", { exact: true })).toBeVisible();
  await expect(page.getByText("USDC", { exact: true })).toBeVisible();

  // Equity is stated once in the strip and once in the shell header.
  await expect(page.getByText("Equity").first()).toBeVisible();
});

test("the ledger opens in a pop-up, reconciles, and closes on Escape", async ({ page }) => {
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 30_000 });

  // The ledger is not on the page until it is asked for.
  await expect(page.getByRole("dialog", { name: "Ledger" })).toBeHidden();

  await page.getByRole("button", { name: /Show ledger/ }).click();
  const ledger = page.getByRole("dialog", { name: "Ledger" });
  await expect(ledger).toBeVisible();

  // The seed transaction is the account's origin, so it is always present.
  await expect(ledger.getByText("Initial deposit").first()).toBeVisible();
  await expect(page.getByText("Ledger reconciles with balances")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(ledger).toBeHidden();
});

test("the rebuilt Portfolio passes the accessibility gate, pop-up included", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 30_000 });

  const closed = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(closed.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  await page.getByRole("button", { name: /Show ledger/ }).click();
  await expect(page.getByRole("dialog", { name: "Ledger" })).toBeVisible();

  const open = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(open.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});
