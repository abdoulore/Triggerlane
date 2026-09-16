import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The account panel in the shell. It exists because deleting the old interface
 * took the only route to account access with it, and an anonymous account that
 * cannot be given up is worse than one that can.
 *
 * Ending access is irreversible: there is no sign-in and no recovery. So the
 * test that matters here is that it cannot happen in one click.
 */

test("the account panel states what the account is and what is locked", async ({ page }) => {
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Open account" }).click();
  const account = page.getByRole("dialog", { name: "Account" });
  await expect(account).toBeVisible();

  // Balances come from the cache the screen already filled, so their presence
  // is also proof the shell reads it rather than fetching its own copy.
  await expect(account.getByText("USDC", { exact: true })).toBeVisible();
  await expect(account.getByText("SOL", { exact: true })).toBeVisible();
  await expect(account.getByText("Available", { exact: true })).toBeVisible();
  await expect(account.getByText("Locked", { exact: true })).toBeVisible();

  // The account is browser-bound, and the panel has to say so.
  await expect(account.getByText(/only in this browser/)).toBeVisible();
  await expect(account.getByText(/no way to recover it/)).toBeVisible();
});

test("ending access takes two decisions, and can be backed out of", async ({ page }) => {
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Open account" }).click();
  const account = page.getByRole("dialog", { name: "Account" });
  await expect(account).toBeVisible();

  // Nothing destructive is reachable in one press.
  await expect(account.getByRole("button", { name: "End access" })).toHaveCount(0);

  await account.getByRole("button", { name: "Clear browser access" }).click();
  await expect(account.getByText("End access from this browser?")).toBeVisible();
  await expect(account.getByText(/cannot reopen it afterwards/)).toBeVisible();
  await expect(account.getByRole("button", { name: "End access" })).toBeVisible();

  // Backing out returns the panel to its resting state, still signed in.
  await account.getByRole("button", { name: "Keep access" }).click();
  await expect(account.getByRole("button", { name: "Clear browser access" })).toBeVisible();
  await expect(account.getByRole("button", { name: "End access" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(account).toBeHidden();

  // The session survived: the screen still has its data.
  await expect(page.getByText("Balances", { exact: true })).toBeVisible();
});

test("the account panel passes the accessibility gate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Open account" }).click();
  await expect(page.getByRole("dialog", { name: "Account" })).toBeVisible();

  const open = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(open.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  // And with the confirmation showing, which is a live region.
  await page.getByRole("button", { name: "Clear browser access" }).click();
  await expect(page.getByText("End access from this browser?")).toBeVisible();
  const confirming = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(confirming.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});
