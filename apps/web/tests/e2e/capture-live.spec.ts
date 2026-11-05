import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Browser capture against a live stack (stamper-services: e2e/stack-calibration.sh): Chromium's fake
 * camera → the capture screen → web key enrolled on chain → claim registered → the Explorer's stamp
 * page shows the record. Runs only when LIVE_CAPTURE=1 and PLAYWRIGHT_BASE_URL (this app) and
 * EXPLORER_BASE_URL (the Explorer) point at that stack; writes the code to LIVE_CAPTURE_OUT.
 */
const live =
  process.env.LIVE_CAPTURE === "1" &&
  !!process.env.PLAYWRIGHT_BASE_URL &&
  !!process.env.EXPLORER_BASE_URL;
const explorer = (process.env.EXPLORER_BASE_URL ?? "").replace(/\/+$/, "");

test.use({
  permissions: ["camera"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("live: take a photo in the browser and find its stamp", async ({ page }) => {
  test.skip(!live, "set LIVE_CAPTURE=1, PLAYWRIGHT_BASE_URL and EXPLORER_BASE_URL");
  test.setTimeout(30 * 60_000);
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[browser] ${m.text()}`);
  });

  await page.goto("/");
  await expect(page.getByTestId("capture-tier")).toBeVisible();
  await page.getByRole("button", { name: "Open camera" }).click();
  const video = page.locator("video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Take photo" }).click();

  const status = page.getByRole("status");
  const done = page.getByTestId("capture-done");
  const t0 = Date.now();
  let last = "";
  while (!(await done.isVisible())) {
    const s = (await status.textContent().catch(() => "")) ?? "";
    if (s && s !== last) {
      console.log(`[capture] +${((Date.now() - t0) / 1000).toFixed(0)} s ${s}`);
      last = s;
    }
    if (/failed|refused|limit|cannot|differently|switched off/i.test(s)) throw new Error(s);
    if (Date.now() - t0 > 15 * 60_000) throw new Error(`capture did not finish; last status: ${s}`);
    await page.waitForTimeout(1000);
  }
  const code = (await done.locator("code").textContent())?.trim() ?? "";
  console.log(
    `[capture] done in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${await done.innerText()}`,
  );
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);
  if (process.env.LIVE_CAPTURE_OUT) writeFileSync(process.env.LIVE_CAPTURE_OUT, `${code}\n`);

  // The chain records the key, then the stamp (a few minutes on Calibration): reload until it shows.
  const t1 = Date.now();
  let text = "";
  for (;;) {
    await page.goto(`${explorer}/v/${code}`);
    await expect(page.locator("main")).toContainText(code, { timeout: 120_000 });
    text = await page.locator("main").innerText();
    if (!/Not registered/i.test(text)) break;
    if (Date.now() - t1 > 15 * 60_000) throw new Error(`${code} still not registered after 15 min`);
    await page.waitForTimeout(20_000);
  }
  console.log(`[stamp page] +${((Date.now() - t1) / 1000).toFixed(0)} s\n${text.slice(0, 800)}`);
});
