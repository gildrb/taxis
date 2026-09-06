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

test("exports a complete Motion keyframe clip from zero while preserving the paused scene", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  const fingerprint = await page.evaluate(() => {
    window.taxis.setParams({ width: 192, height: 192, useCells: true, sourceMode: "ignore", cellSize: 40, cellGapX: 16, cellGapY: 16, animation: "none", keyframeDuration: 1, keyframeLoop: false, animationTime: 0.75 });
    return window.taxis.setParams({ keyframeTracks: [{ target: "cell:0:1:1", property: "x", keyframes: [{ time: 0, value: 0, easing: [0.25, 0.1, 0.25, 1] }, { time: 1, value: 32 }] }] }).fingerprint;
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "MP4", exact: true }).check();
  await expect(dialog.getByLabel("Duration", { exact: true })).toHaveValue("1");
  await dialog.getByLabel("FPS", { exact: true }).fill("4");
  const pending = page.waitForEvent("download");
  await dialog.locator('button[type="submit"]').click();
  const bytes = await readFile((await (await pending).path())!);
  const proof = await page.evaluate(async (encoded) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    const url = URL.createObjectURL(new Blob([new Uint8Array(encoded)], { type: "video/mp4" }));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const context = canvas.getContext("2d")!;
    const meanError = (first: ArrayLike<number>, second: ArrayLike<number>) => {
      let sum = 0;
      for (let index = 0; index < first.length; index++) sum += Math.abs(first[index]! - second[index]!);
      return sum / first.length;
    };
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error(video.error?.message ?? "Video decode failed"));
        video.src = url;
        video.load();
      });
      const cursor = window.taxis.getScene().params.animationTime;
      const initialVsPaused = meanError(window.taxis.render(-cursor).pixels, window.taxis.render().pixels);
      const errors = [];
      for (let index = 0; index < 4; index++) {
        await new Promise<void>((resolve) => { video.onseeked = () => resolve(); video.currentTime = (index + 0.1) / 4; });
        context.drawImage(video, 0, 0);
        errors.push(meanError(context.getImageData(0, 0, 192, 192).data, window.taxis.render(index / 4 - cursor).pixels));
      }
      return { errors, initialVsPaused, duration: video.duration, cursor, fingerprint: window.taxis.getScene().fingerprint };
    } finally {
      video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
      canvas.width = canvas.height = 0;
    }
  }, [...bytes]);
  expect(proof.duration).toBeCloseTo(1, 6);
  expect(proof.cursor).toBe(0.75);
  expect(proof.fingerprint).toBe(fingerprint);
  expect(proof.initialVsPaused).toBeGreaterThan(4);
  expect(proof.errors).toHaveLength(4);
  for (const error of proof.errors) expect(error).toBeLessThan(2);
});
