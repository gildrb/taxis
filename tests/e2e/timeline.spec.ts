import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { chooseOption } from "./menu";

async function prepare(page: Page, withKeys = false) {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  await page.evaluate((keys) => window.taxis.setParams({
    useCells: true, sourceMode: "ignore", width: 320, height: 240, cellSize: 24,
    animation: "none", animationTime: 0, keyframeDuration: 4, keyframeLoop: false,
    keyframeTracks: keys ? [{ target: "all", property: "x", keyframes: [
      { time: 0, value: 0, easing: [0, 0, 1, 1] },
      { time: 4, value: 60, easing: [0, 0, 1, 1] },
    ] }] : [],
  }), withKeys);
  await expect(page.getByLabel("Pattern preview, 320 by 240 pixels", { exact: true })).toBeVisible();
}

test("timeline is optional, compact, keyboard reachable, and restores focus", async ({ page }) => {
  await prepare(page);
  const toggle = page.getByRole("button", { name: "Timeline", exact: true });
  await expect(page.getByTestId("timeline")).toHaveCount(0);
  const before = await page.locator("canvas").boundingBox();
  await toggle.focus();
  await toggle.press("Enter");
  const dock = page.getByTestId("timeline");
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("button", { name: "Play animation", exact: true })).toBeFocused();
  await expect(dock.getByText("No keys", { exact: true })).toBeVisible();
  await expect(dock.getByRole("button", { name: "Delete key", exact: true })).toBeDisabled();
  const bounds = await dock.boundingBox();
  expect(bounds!.height).toBeLessThanOrEqual(240);
  const canvas = await page.locator("canvas").boundingBox();
  expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(bounds!.y + 2);
  await dock.getByRole("button", { name: "Close timeline" }).click();
  await expect(dock).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect.poll(async () => Math.round((await page.locator("canvas").boundingBox())!.height)).toBe(Math.round(before!.height));
});

test("authors exact keys and Bezier easing, then round trips the scene", async ({ page }) => {
  await prepare(page);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  const dock = page.getByTestId("timeline");
  await dock.getByRole("button", { name: "Add key", exact: true }).click();
  await dock.getByRole("spinbutton", { name: "Key value", exact: true }).fill("-12.123456");
  await dock.getByRole("spinbutton", { name: "Key value", exact: true }).press("Enter");
  await dock.getByRole("slider", { name: "Timeline position" }).fill("4");
  await dock.getByRole("button", { name: "Add key", exact: true }).click();
  await dock.getByRole("spinbutton", { name: "Key time", exact: true }).fill("3.5");
  await dock.getByRole("spinbutton", { name: "Key time", exact: true }).press("Enter");
  await dock.getByRole("spinbutton", { name: "Key value", exact: true }).fill("48.654321");
  await dock.getByRole("spinbutton", { name: "Key value", exact: true }).press("Enter");
  await dock.getByRole("button", { name: /^Position X key 1 at/ }).click();
  for (const [name, value] of [["x1", "0.25"], ["y1", "-0.123456"], ["x2", "0.75"], ["y2", "1.2"]]) {
    const input = dock.getByRole("spinbutton", { name: `Bezier ${name}`, exact: true });
    await input.fill(value!);
    await input.press("Enter");
  }
  await dock.getByRole("checkbox", { name: "Loop", exact: true }).check();
  const scene = await page.evaluate(() => window.taxis.getScene());
  expect(scene.params.keyframeLoop).toBe(true);
  expect(scene.params.keyframeTracks).toEqual([{ target: "all", property: "x", keyframes: [
    { time: 0, value: -12.123456, easing: [0.25, -0.123456, 0.75, 1.2] },
    { time: 3.5, value: 48.654321, easing: [0, 0, 1, 1] },
  ] }]);
  const restored = await page.evaluate(async (project) => {
    await window.taxis.setScene(JSON.parse(JSON.stringify(project)));
    return window.taxis.getScene();
  }, scene);
  expect(restored.fingerprint).toBe(scene.fingerprint);
  expect(restored.params.keyframeTracks).toEqual(scene.params.keyframeTracks);
});

test("drags keyframe and Bezier handles with keyboard alternatives and undo", async ({ page }) => {
  await prepare(page, true);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  const dock = page.getByTestId("timeline");
  const first = dock.getByRole("button", { name: /^Position X key 1 at/ });
  await first.focus();
  await first.press("ArrowRight");
  await expect(dock.getByRole("spinbutton", { name: "Key time", exact: true })).toHaveValue("0.01");
  await first.press("Home");
  const start = await first.boundingBox();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(start!.x + start!.width / 2 + 40, start!.y + start!.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await dock.getByRole("spinbutton", { name: "Key time", exact: true }).inputValue()).not.toBe("0");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.taxis.getScene().params.keyframeTracks[0]!.keyframes[0]!.time)).toBe(0);
  await first.click();
  const handle = dock.getByRole("button", { name: "Bezier handle 1; use arrow keys", exact: true });
  await handle.focus();
  await handle.press("ArrowUp");
  await expect(dock.getByRole("spinbutton", { name: "Bezier y1", exact: true })).toHaveValue("0.01");
  const point = await handle.boundingBox();
  await page.mouse.move(point!.x + point!.width / 2, point!.y + point!.height / 2);
  await page.mouse.down();
  await page.mouse.move(point!.x + point!.width / 2 + 20, point!.y + point!.height / 2 - 12, { steps: 5 });
  await page.mouse.up();
  expect(Number(await dock.getByRole("spinbutton", { name: "Bezier x1", exact: true }).inputValue())).toBeGreaterThan(0.2);
  expect(Number(await dock.getByRole("spinbutton", { name: "Bezier y1", exact: true }).inputValue())).toBeGreaterThan(0.3);
  await dock.getByRole("spinbutton", { name: "Bezier y1", exact: true }).fill("3");
  await dock.getByRole("spinbutton", { name: "Bezier y1", exact: true }).press("Enter");
  await dock.getByRole("spinbutton", { name: "Bezier y2", exact: true }).fill("-2");
  await dock.getByRole("spinbutton", { name: "Bezier y2", exact: true }).press("Enter");
  const graph = await handle.locator("..").boundingBox();
  const high = await handle.boundingBox();
  const low = await dock.getByRole("button", { name: "Bezier handle 2; use arrow keys", exact: true }).boundingBox();
  expect(high!.y + high!.height / 2 - graph!.y).toBeCloseTo(14, 0);
  expect(low!.y + low!.height / 2 - graph!.y).toBeCloseTo(94, 0);
  await first.focus();
  await first.press("Delete");
  await expect.poll(() => page.evaluate(() => window.taxis.getScene().params.keyframeTracks[0]!.keyframes.length)).toBe(1);
});

test("canvas-selected cells author isolated tracks with existing identities", async ({ page }) => {
  await prepare(page);
  const cell = await page.evaluate(() => window.taxis.evaluate().entities!.find((entity) => entity.id === "cell:0:3:3")!);
  expect(cell.visible).toBe(true);
  const canvas = page.locator("canvas");
  const bounds = await canvas.boundingBox();
  await canvas.click({ position: { x: cell.pose.x / 320 * bounds!.width, y: cell.pose.y / 240 * bounds!.height } });
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  const dock = page.getByTestId("timeline");
  await expect(dock.getByRole("combobox", { name: "Keyframe target" })).toHaveText("Selected cell");
  await chooseOption(page, "Keyframe property", "Rotation");
  await dock.getByRole("button", { name: "Add key", exact: true }).click();
  await dock.getByRole("spinbutton", { name: "Key value", exact: true }).fill("37");
  await dock.getByRole("spinbutton", { name: "Key value", exact: true }).press("Enter");
  const result = await page.evaluate(() => ({ tracks: window.taxis.getScene().params.keyframeTracks, cells: window.taxis.evaluate().entities! }));
  expect(result.tracks[0]!.target).toBe(cell.id);
  expect(result.cells.find((entity) => entity.id === cell.id)!.pose.rotation).toBe(37);
  expect(result.cells.filter((entity) => entity.id !== cell.id).every((entity) => entity.pose.rotation === 0)).toBe(true);
});

test("live easing edits keep playback running while scrubbing pauses", async ({ page }) => {
  await prepare(page, true);
  await page.evaluate(() => window.taxis.setParams({ keyframeLoop: true }));
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  const dock = page.getByTestId("timeline");
  await dock.getByRole("button", { name: /^Position X key 1 at/ }).click();
  await dock.getByRole("button", { name: "Play animation", exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector("canvas")?.dataset.time) > 0.2);
  const before = await page.locator("canvas").getAttribute("data-time");
  await dock.getByRole("spinbutton", { name: "Bezier y1", exact: true }).fill("0.8");
  await dock.getByRole("spinbutton", { name: "Bezier y1", exact: true }).press("Enter");
  await expect(dock.getByRole("button", { name: "Pause animation", exact: true })).toBeVisible();
  await expect.poll(async () => Number(await page.locator("canvas").getAttribute("data-time"))).toBeGreaterThan(Number(before) + 0.15);
  await dock.getByRole("slider", { name: "Timeline position" }).fill("1.25");
  await expect(dock.getByRole("button", { name: "Play animation", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.taxis.getScene().params.animationTime)).toBe(1.25);
  await expect(page.locator("canvas")).toHaveAttribute("data-time", "1.25");
});

test("mobile and narrow desktop controls stay inside the dock width", async ({ page }) => {
  await prepare(page, true);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 900 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    const dock = page.getByTestId("timeline");
    await expect(dock).toBeVisible();
    await dock.getByRole("button", { name: /^Position X key 1 at/ }).click();
    const sizes = await dock.evaluate((node) => ({ client: node.clientWidth, scroll: node.scrollWidth, page: document.documentElement.scrollWidth, viewport: innerWidth, fontSize: getComputedStyle(node).fontSize }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
    expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);
    expect(Number.parseFloat(sizes.fontSize)).toBeGreaterThanOrEqual(14);
    const controls = [
      ...["Add key", "Delete key", "Close timeline"].map((name) => dock.getByRole("button", { name, exact: true })),
      ...["x1", "y1", "x2", "y2"].map((coordinate) => dock.getByRole("spinbutton", { name: `Bezier ${coordinate}`, exact: true })),
    ];
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      const frame = await dock.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(frame!.x);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
      expect(bounds!.y).toBeGreaterThanOrEqual(frame!.y);
      // Scrolling rounds CSS pixels; DOM rectangles retain subpixel fractions.
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(frame!.y + frame!.height + 1);
    }
    const input = dock.getByRole("spinbutton", { name: "Bezier x2", exact: true });
    await input.focus();
    await input.fill("0.75");
    await input.press("Enter");
    await expect(input).toHaveValue("0.75");
    await dock.getByRole("button", { name: "Close timeline" }).click();
    await expect(page.getByRole("button", { name: "Timeline", exact: true })).toBeFocused();
  }
});

test("scrubber pointer and held-key gestures each create one undo entry", async ({ page }) => {
  await prepare(page, true);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  const slider = page.getByTestId("timeline").getByRole("slider", { name: "Timeline position" });
  const bounds = await slider.boundingBox();
  await page.mouse.move(bounds!.x + 8, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.6, bounds!.y + bounds!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.taxis.getScene().params.animationTime)).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.taxis.getScene().params.animationTime)).toBe(0);
  await slider.focus();
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await expect.poll(() => page.evaluate(() => window.taxis.getScene().params.animationTime)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.taxis.getScene().params.animationTime)).toBe(0);
});
