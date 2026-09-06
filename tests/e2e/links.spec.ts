import { expect, test } from "@playwright/test";

test("reloads and shares large keyframe scenes without an oversized HTTP query", async ({ page, context }) => {
  await page.goto("/?workspace=keep#section");
  await page.waitForFunction(() => Boolean(window.taxis));
  const fingerprint = await page.evaluate(() => window.taxis.setParams({
    width: 192, height: 192, cellSize: 12, cellGapX: 6, cellGapY: 6,
    sourceMode: "ignore", animation: "none", animationTime: 0.4,
    keyframeTracks: Array.from({ length: 100 }, (_, index) => ({
      target: `cell:0:${Math.floor(index / 10)}:${index % 10}`, property: "x",
      keyframes: [{ time: 0, value: 0, easing: [0.25, 0.1, 0.25, 1] }, { time: 1, value: 32 }],
    })),
  }).fingerprint);
  await expect.poll(() => new URL(page.url()).hash.includes("settings=")).toBe(true);
  const linked = new URL(page.url());
  expect(linked.search.length).toBeLessThanOrEqual(6000);
  expect(linked.searchParams.has("settings")).toBe(false);
  expect(linked.searchParams.get("workspace")).toBe("keep");
  expect(linked.hash.startsWith("#section&settings=")).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.taxis?.getScene().fingerprint)).toBe(fingerprint);
  const shared = await context.newPage();
  try {
    await shared.goto(linked.href);
    await expect.poll(() => shared.evaluate(() => window.taxis?.getScene().fingerprint)).toBe(fingerprint);
    expect(await shared.evaluate(() => window.taxis.getScene().params.keyframeTracks.length)).toBe(100);
    await shared.evaluate(() => window.taxis.setParams({ keyframeTracks: [] }));
    await expect.poll(() => new URL(shared.url()).searchParams.has("settings")).toBe(true);
    expect(new URL(shared.url()).hash).toBe("#section");
  } finally { await shared.close(); }
});
