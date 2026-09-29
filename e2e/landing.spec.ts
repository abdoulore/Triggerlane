import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The landing page, which still runs the design the product screens replaced.
 *
 * These carry over from the launch audit unchanged in substance: the scene has
 * to actually draw, the promise has to be readable without scrolling, the page
 * has to survive a phone, it has to explain itself without WebGL, and it has to
 * hold still for anyone who asked for reduced motion. The audit's ghost-core
 * half is gone with the 3D detail view it tested.
 */

async function expectCanvasContributesVisiblePixels(page: Page, selector: string) {
  const canvas = page.locator(selector);
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const visible = await page.screenshot({ clip: box!, animations: "disabled" });
  await canvas.evaluate((element) => { element.style.visibility = "hidden"; });
  const hidden = await page.screenshot({ clip: box!, animations: "disabled" });
  await canvas.evaluate((element) => { element.style.visibility = ""; });
  expect(visible.equals(hidden), `${selector} should alter its rendered screen region`).toBe(false);
}

test("the landing teaches the product through the real scene", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Trade the whole moment." })).toBeVisible({ timeout: 30_000 });

  const primary = page.getByRole("link", { name: /CREATE A TRIGGER/ }).first();
  await expect(primary).toHaveAttribute("href", "/trade");

  // The scene has to draw, not merely occupy space.
  await expectCanvasContributesVisiblePixels(page, 'canvas[data-scene="signal-engine"]');

  const firstViewport = await page.evaluate(() => ({
    primaryBottom: document.querySelector(".landing-primary")!.getBoundingClientRect().bottom,
    proofTop: document.querySelector(".hero-signal-console")!.getBoundingClientRect().top,
    viewport: window.innerHeight,
  }));
  expect(firstViewport.primaryBottom).toBeLessThan(firstViewport.viewport);
  expect(firstViewport.proofTop).toBeLessThan(firstViewport.viewport);

  await page.getByRole("button", { name: /PLAY THE EXAMPLE/ }).click();
  await expect(page.getByText("FILLED ONCE", { exact: true }).first()).toBeVisible({ timeout: 9_000 });

  await page.getByRole("link", { name: "SEE HOW IT WORKS" }).click();
  await expect(page.getByRole("heading", { name: "Conditional trading in three human steps." })).toBeVisible();

  // All three steps are visible at once; a heading promising three of them
  // followed by a panel showing one was the unclear part.
  const steps = page.locator(".guide-steps article");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("Choose your moment");
  await expect(steps.nth(1)).toContainText("Let Triggerlane wait");
  await expect(steps.nth(2)).toContainText("Get one clear result");
  await expect(page.getByText("FILLED ONCE, RECEIPT STORED")).toHaveCount(0);
});

test("the landing stays framed and non-blank on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Trade the whole moment." })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('canvas[data-scene="signal-engine"]')).toBeVisible();

  const measured = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    primaryBottom: document.querySelector(".landing-primary")!.getBoundingClientRect().bottom,
    proofTop: document.querySelector(".hero-signal-console")!.getBoundingClientRect().top,
    innerHeight: window.innerHeight,
  }));
  expect(measured.scrollWidth).toBeLessThanOrEqual(measured.innerWidth);
  expect(measured.primaryBottom).toBeLessThan(measured.innerHeight);
  expect(measured.proofTop).toBeLessThan(measured.innerHeight);
});

test("the landing explains itself without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return original.call(this, type as never, ...args as never);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/");
  const fallback = page.getByRole("img", { name: /Signal Engine fallback/ });
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  await expect(fallback).toContainText("SOL price");
  await expect(fallback).toContainText("SELL 25% SOL");
});

test("reduced motion holds the landing scene still", async ({ page }) => {
  const sample = () => page.locator('canvas[data-scene="signal-engine"]').evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    if (!context) return [];
    const pixels = new Uint8Array(4 * 12 * 12);
    context.readPixels(0, 0, 12, 12, context.RGBA, context.UNSIGNED_BYTE, pixels);
    return Array.from(pixels);
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator('canvas[data-scene="signal-engine"]')).toBeVisible({ timeout: 30_000 });
  const first = await sample();
  await page.waitForTimeout(700);
  expect(await sample()).toEqual(first);
});

test("the landing passes the accessibility gate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Trade the whole moment." })).toBeVisible({ timeout: 30_000 });
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});
