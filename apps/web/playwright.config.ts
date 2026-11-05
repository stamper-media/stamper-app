import { defineConfig, devices } from "@playwright/test";

/**
 * Live browser capture against a running stack (stamper-services: e2e/stack-calibration.sh):
 *   PLAYWRIGHT_BASE_URL=http://localhost:13311 LIVE_CAPTURE=1 pnpm --filter @stamper/app test:live
 * The Explorer origin for the stamp-page check comes from EXPLORER_BASE_URL.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["line"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "off",
    ...devices["Pixel 7"],
    viewport: { width: 360, height: 780 },
  },
  projects: [{ name: "chromium-mobile", use: { browserName: "chromium" } }],
});
