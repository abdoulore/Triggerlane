import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  outputDir: "test-results/artifacts",
  reporter: process.env.CI ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:15173",
    channel: process.env.CI ? undefined : "chrome",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run dev:e2e",
    url: "http://127.0.0.1:15173/health/ready",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR ?? ".data/e2e-release",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-release-session-secret-at-least-32-characters",
      API_PORT: "18787",
      API_INTERNAL_URL: "http://127.0.0.1:18787",
      NEXT_PUBLIC_API_URL: "",
      NEXT_DIST_DIR: ".next-e2e",
      RATE_LIMIT_IP_PER_MINUTE: "10000",
      RATE_LIMIT_SESSION_MUTATIONS_PER_MINUTE: "1000",
      RATE_LIMIT_ANONYMOUS_SESSIONS_PER_HOUR: "1000",
    },
  },
});
