import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from "mediabunny";
import { downloadExport } from "./export";

test("exports genuine JPEG and WebP through the single Export menu", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  await page.evaluate(() => window.taxis.setParams({ width: 256, height: 192, useCells: true }));
  const trigger = page.getByRole("button", { name: "Export", exact: true });
  await expect(trigger).toHaveCount(1);
  const colors = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor.match(/\d+/g)!.slice(0, 3).map(Number));
  expect(colors.every((channel) => channel >= 220)).toBe(true);
  for (const format of ["jpeg", "webp"] as const) {
    const download = await downloadExport(page, format);
    expect(download.suggestedFilename()).toMatch(/^taxis-[a-f0-9]{16}\.(jpg|webp)$/);
    const bytes = await readFile((await download.path())!);
    if (format === "jpeg") expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
    else {
      expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
      expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
    }
  }
});

test("exports actual timed MP4 cell frames from the menu", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  await page.evaluate(() => window.taxis.setParams({ width: 256, height: 192, useCells: true, sourceMode: "ignore", cellSize: 24, cellGapX: 6, cellGapY: 6, animation: "wave", animationTime: 0 }));
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "MP4", exact: true })).toBeEnabled();
  await dialog.getByRole("radio", { name: "MP4", exact: true }).check();
  await dialog.getByLabel("Duration", { exact: true }).fill("1");
  await dialog.getByLabel("FPS", { exact: true }).fill("6");
  const pending = page.waitForEvent("download");
  await dialog.locator('button[type="submit"]').click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  expect(download.suggestedFilename()).toMatch(/^taxis-[a-f0-9]{16}\.mp4$/);
  expect(bytes.toString("ascii", 4, 8)).toBe("ftyp");
  const input = new Input({ source: new BlobSource(new Blob([new Uint8Array(bytes)])), formats: ALL_FORMATS });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    expect(await track.getCodedWidth()).toBe(256);
    expect(await track.getCodedHeight()).toBe(192);
    expect(await input.computeDuration()).toBeCloseTo(1, 6);
    const timestamps = [];
    for await (const packet of new EncodedPacketSink(track).packets()) timestamps.push(packet.timestamp);
    expect(timestamps).toHaveLength(6);
    timestamps.forEach((timestamp, index) => expect(timestamp).toBeCloseTo(index / 6, 5));
  } finally { input.dispose(); }
  await expect(dialog.locator('button[type="submit"]')).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeFocused();
});
