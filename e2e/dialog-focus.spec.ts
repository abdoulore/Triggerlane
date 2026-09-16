import { expect, test, type Page } from "@playwright/test";

/**
 * Focus behaviour for every pop-up in the product.
 *
 * A dialog that claims aria-modal has to keep Tab inside itself and hand focus
 * back when it closes. Neither is something an automated accessibility scan
 * reports, so all of it passed unnoticed until a keyboard was actually used:
 * dismissing a pop-up dropped focus onto the document body.
 */

const POPUPS: Array<{ name: string; path: string; heading: string; opener: RegExp | string; dialog: string }> = [
  { name: "ledger", path: "/portfolio", heading: "Portfolio", opener: /Show ledger/, dialog: "Ledger" },
];

async function open(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 30_000 });
}

for (const popup of POPUPS) {
  test(`the ${popup.name} pop-up returns focus when dismissed with Escape`, async ({ page }) => {
    await open(page, popup.path, popup.heading);
    const opener = page.getByRole("button", { name: popup.opener });
    await opener.click();
    await expect(page.getByRole("dialog", { name: popup.dialog })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: popup.dialog })).toBeHidden();
    await expect(opener, "Escape should return focus to the control that opened it").toBeFocused();
  });

  test(`the ${popup.name} pop-up returns focus when dismissed with its close control`, async ({ page }) => {
    await open(page, popup.path, popup.heading);
    const opener = page.getByRole("button", { name: popup.opener });
    await opener.click();

    const dialog = page.getByRole("dialog", { name: popup.dialog });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: `Close ${popup.dialog}` }).click();
    await expect(dialog).toBeHidden();
    await expect(opener, "closing should return focus to the control that opened it").toBeFocused();
  });

  test(`the ${popup.name} pop-up keeps Tab inside itself`, async ({ page }) => {
    await open(page, popup.path, popup.heading);
    await page.getByRole("button", { name: popup.opener }).click();
    const dialog = page.getByRole("dialog", { name: popup.dialog });
    await expect(dialog).toBeVisible();

    // Walk further than the dialog has stops and confirm focus never escapes.
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const open = document.querySelector('[role="dialog"]');
        return open ? open.contains(document.activeElement) : false;
      });
      expect(inside, `focus left the pop-up after ${step + 1} tab presses`).toBe(true);
    }
  });
}
