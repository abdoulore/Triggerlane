import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The rebuilt Ideas screen, now serving /discover. An idea is a starting point:
 * choosing one opens it on Trade as an editable draft and places nothing.
 */

test("Ideas lists the catalog and previews the selected one", async ({ page }) => {
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Find a starting point" })).toBeVisible({ timeout: 30_000 });

  // Four templates ship today; the list shows all of them, not a slice.
  await expect(page.getByRole("button", { name: "Buy the Fear" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Euphoria Exit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Downside Break" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Price Breakout" })).toBeVisible();

  // The first idea previews by default.
  await expect(page.getByRole("button", { name: "Buy the Fear" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Idea conditions" }).locator("div")).toHaveCount(3);

  // Funding reads as an annual rate here too, never as a bare hourly ratio.
  await expect(page.getByText(/%\s*APR/).first()).toBeVisible();

  await page.getByRole("button", { name: "Price Breakout" }).click();
  await expect(page.getByRole("button", { name: "Price Breakout" })).toHaveAttribute("aria-pressed", "true");
  // Price Breakout is the one-signal idea.
  await expect(page.getByRole("group", { name: "Idea conditions" }).locator("div")).toHaveCount(1);
});

test("using an idea opens it on Trade without placing anything", async ({ page }) => {
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Find a starting point" })).toBeVisible({ timeout: 30_000 });

  const before = await page.evaluate(async () =>
    ((await (await fetch("/api/ghosts", { credentials: "include" })).json()) as unknown[]).length);

  await page.getByRole("button", { name: "Euphoria Exit" }).click();
  await page.getByRole("button", { name: "Use this setup" }).click();

  await expect(page.getByLabel("Trigger name")).toHaveValue("Euphoria Exit", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sell", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Amount")).toHaveValue("25");
  await expect(page.getByText("From Ideas")).toBeVisible();

  const after = await page.evaluate(async () =>
    ((await (await fetch("/api/ghosts", { credentials: "include" })).json()) as unknown[]).length);
  expect(after).toBe(before);
});

test("Ideas passes the accessibility gate and fits a phone", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Find a starting point" })).toBeVisible({ timeout: 30_000 });

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vp: window.innerWidth }));
  expect(overflow.doc).toBeLessThanOrEqual(overflow.vp);
});
