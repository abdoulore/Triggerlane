import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The gates that outlive any one design.
 *
 * These carry forward from the launch audit written against the old interface:
 * the product may never claim real execution, every screen has to survive a
 * phone, failures have to say they failed, and the whole thing has to stay
 * reachable by keyboard and screen reader. The markup they check changed; what
 * they protect did not.
 */

const PRODUCT_ROUTES = [
  { path: "/trade", heading: "SOL-PERP" },
  { path: "/ghosts", heading: "Triggers" },
  { path: "/portfolio", heading: "Portfolio" },
  { path: "/discover", heading: "Find a starting point" },
] as const;

const LANDING = { path: "/", heading: "Trade the whole moment." } as const;

async function open(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 30_000 });
}

test("nothing anywhere claims real money moved", async ({ page }) => {
  for (const route of [LANDING, ...PRODUCT_ROUTES]) {
    await open(page, route.path, route.heading);
    const text = await page.locator("body").innerText();
    expect(text, `${route.path} claims a live connection`).not.toMatch(/RIALO\s+(CONNECTED|LIVE|DEPLOYED)/i);
    expect(text, `${route.path} promises an outcome`).not.toMatch(/guaranteed (profit|return)/i);

    // Saying no real assets move is the promise, not a breach of it. Only an
    // unnegated claim counts, so the denial the landing prints stays legal.
    const claims = [...text.matchAll(/real (funds|assets) (moved|traded|executed)/gi)].filter((match) => {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index);
      return !/\b(no|not|never|without|zero)\b[^.]{0,30}$/i.test(before);
    });
    expect(claims.map((match) => match[0]), `${route.path} claims real funds moved`).toEqual([]);
  }
});

test("every product screen states that the funds are virtual", async ({ page }) => {
  for (const route of PRODUCT_ROUTES) {
    await open(page, route.path, route.heading);
    await expect(
      page.getByText("Trades use virtual funds. No real assets move."),
      `${route.path} is missing the virtual funds notice`,
    ).toBeVisible();
    await expect(page.getByText("PAPER", { exact: true })).toBeVisible();
  }
});

test("every screen names itself and sits in a main landmark", async ({ page }) => {
  for (const route of PRODUCT_ROUTES) {
    await open(page, route.path, route.heading);
    const structure = await page.evaluate(() => ({
      mains: document.querySelectorAll("main").length,
      h1s: [...document.querySelectorAll("h1")].map((h) => h.textContent?.trim()),
      navs: document.querySelectorAll("nav").length,
    }));
    expect(structure.mains, `${route.path} main landmark`).toBe(1);
    expect(structure.h1s.length, `${route.path} heading`).toBe(1);
    expect(structure.navs, `${route.path} navigation`).toBeGreaterThan(0);
  }
});

test("a failed load says it failed rather than waiting forever", async ({ page }) => {
  // The portfolio shipped this bug once: an error rendered as endless loading.
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "GATE_TEST", message: "Injected outage" } }),
    }),
  );
  await page.goto("/portfolio");
  await expect(page.getByText("The portfolio could not be loaded.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Loading portfolio…")).toHaveCount(0);
  await page.unroute("**/api/workspace");
});

for (const viewport of [
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
  { name: "tablet-820", width: 820, height: 1180 },
  { name: "laptop-1280", width: 1280, height: 720 },
  { name: "desktop-1920", width: 1920, height: 1080 },
] as const) {
  test(`every screen fits ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of [LANDING, ...PRODUCT_ROUTES]) {
      await open(page, route.path, route.heading);
      const measured = await page.evaluate(() => {
        const out = [...document.querySelectorAll("header,nav,main,aside,button,input,select,h1")]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.right <= window.innerWidth + 1) return false;
            let parent = element.parentElement;
            while (parent) {
              const style = getComputedStyle(parent);
              if (["auto", "scroll"].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth) return false;
              parent = parent.parentElement;
            }
            return true;
          })
          .slice(0, 3)
          .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}`);
        return { doc: document.documentElement.scrollWidth, vp: window.innerWidth, out };
      });
      expect(measured.doc, `${route.path} overflows at ${viewport.name}`).toBeLessThanOrEqual(measured.vp);
      expect(measured.out, `${route.path} has elements outside ${viewport.name}`).toEqual([]);
    }
  });
}

test("every screen passes the accessibility gate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of [LANDING, ...PRODUCT_ROUTES]) {
    await open(page, route.path, route.heading);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = result.violations
      .filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
      .map((violation) => `${route.path}: ${violation.id}`);
    expect(serious).toEqual([]);
  }
});

test("core routes stay inside their navigation budgets", async ({ page }) => {
  for (const route of [LANDING, ...PRODUCT_ROUTES]) {
    const started = Date.now();
    await open(page, route.path, route.heading);
    const interactiveMs = Date.now() - started;
    const timing = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return { domContentLoadedMs: navigation.domContentLoadedEventEnd, responseMs: navigation.responseEnd };
    });
    expect(interactiveMs, `${route.path} interactive budget`).toBeLessThan(30_000);
    expect(timing.domContentLoadedMs, `${route.path} DOM budget`).toBeLessThan(10_000);
  }
});

/*
 * A phone held sideways, a reader who enlarged the text, and a viewer at 200%
 * zoom all get the same layout arithmetic wrong in different ways. The launch
 * audit checked these three and nothing else did.
 */
for (const profile of [
  { name: "landscape-phone", width: 844, height: 390, fontSize: null, zoom: "1" },
  { name: "large-text", width: 1280, height: 720, fontSize: "125%", zoom: "1" },
  { name: "zoom-200", width: 1280, height: 720, fontSize: null, zoom: "2" },
] as const) {
  test(`every screen stays usable at ${profile.name}`, async ({ page }) => {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of PRODUCT_ROUTES) {
      await open(page, route.path, route.heading);
      await page.evaluate(({ zoom, fontSize }) => {
        document.documentElement.style.zoom = zoom;
        if (fontSize) document.documentElement.style.fontSize = fontSize;
      }, { zoom: profile.zoom, fontSize: profile.fontSize });
      await page.waitForTimeout(350);
      const measured = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        vp: window.innerWidth,
      }));
      expect(measured.doc, `${route.path} overflows at ${profile.name}`).toBeLessThanOrEqual(measured.vp);
      // The action a trader came for has to remain on screen.
      await expect(page.getByText("Trades use virtual funds. No real assets move.")).toBeVisible();
    }
  });
}
