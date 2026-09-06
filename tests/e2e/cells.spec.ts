import { expect, test } from "@playwright/test";
import { chooseOption } from "./menu";

test("changes each complete cell's shape and spacing through product controls", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  await page.evaluate(() => window.taxis.setParams({ width: 400, height: 300, cellSize: 40, sourceMode: "ignore" }));
  await page.getByRole("checkbox", { name: "Use cells", exact: true }).check();
  await chooseOption(page, "Cell shape", "Triangle");
  const initial = await page.evaluate(() => window.taxis.evaluate());
  expect(initial.primitives).toHaveLength(70);
  expect(initial.primitives.every((shape) => shape.points?.length === 3)).toBe(true);
  expect(initial.mask).toBeUndefined();
  expect(initial.masks).toBeUndefined();
  expect((await page.evaluate(() => window.taxis.getScene())).params.maskShape).toBe("none");
  await page.getByRole("slider", { name: "Gap X", exact: true }).fill("12");
  await page.getByRole("slider", { name: "Gap Y", exact: true }).fill("10");
  const spaced = await page.evaluate(() => window.taxis.evaluate());
  const xs = [...new Set(spaced.primitives.map((shape) => Number((shape.x + shape.width / 2).toFixed(6))))].sort((a, b) => a - b);
  const ys = [...new Set(spaced.primitives.map((shape) => Number((shape.y + shape.height / 2).toFixed(6))))].sort((a, b) => a - b);
  expect(xs).toHaveLength(7);
  expect(ys).toHaveLength(6);
  expect(xs[1]! - xs[0]!).toBeCloseTo(52, 5);
  expect(ys[1]! - ys[0]!).toBeCloseTo(50, 5);
  await page.getByRole("slider", { name: "Cell padding", exact: true }).fill("3");
  const padded = await page.evaluate(() => window.taxis.evaluate());
  expect(padded.primitives).toHaveLength(spaced.primitives.length);
  expect(padded.primitives[0]!.width).toBeLessThan(spaced.primitives[0]!.width);
  expect((await page.evaluate(() => window.taxis.getScene())).params).toMatchObject({ cellGapX: 12, cellGapY: 10, cellPadding: 3, layoutGapX: 0, layoutGapY: 0 });
  await page.screenshot({ path: "/tmp/taxis-whole-triangles.png" });
});

test("keeps transformed source-boundary cells complete and exports editable vectors", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  const result = await page.evaluate(() => {
    window.taxis.setParams({ useCells: true, cellShape: "triangle", sourceMode: "mask", width: 357, height: 299,
      cellSize: 19, cellGapX: 5, cellGapY: 7, cellRotation: 15, rotation: 21, patternScaleX: 1.2, patternOffsetX: 14 });
    return { first: window.taxis.evaluate(), second: window.taxis.evaluate(), svg: window.taxis.svg() };
  });
  expect(result.first).toEqual(result.second);
  expect(result.first.primitives.length).toBeGreaterThan(20);
  expect(result.first.primitives.every((shape) => shape.points?.length === 3)).toBe(true);
  for (const shape of result.first.primitives) {
    expect(shape.x).toBeGreaterThanOrEqual(-0.000001);
    expect(shape.y).toBeGreaterThanOrEqual(-0.000001);
    expect(shape.x + shape.width).toBeLessThanOrEqual(357.000001);
    expect(shape.y + shape.height).toBeLessThanOrEqual(299.000001);
  }
  expect(result.svg).not.toMatch(/<(?:mask|clipPath|image)\b/);
  expect(result.svg).toMatch(/<(?:path|polygon)\b/);
});

test("uses page-styled dropdowns with keyboard selection, dismissal, and viewport bounds", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  expect(await page.locator("select").count()).toBe(0);
  const symmetry = page.getByRole("combobox", { name: "Symmetry", exact: true });
  await symmetry.focus();
  await symmetry.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await symmetry.press("End");
  await symmetry.press("Enter");
  await expect.poll(() => page.evaluate(() => window.taxis.getScene().params.symmetry)).toBe("both");
  await expect(symmetry).toBeFocused();
  await symmetry.click();
  await symmetry.press("Home");
  await symmetry.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  expect(await page.evaluate(() => window.taxis.getScene().params.symmetry)).toBe("both");
  await expect(symmetry).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await symmetry.click();
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  await expect.poll(async () => {
    const bounds = await menu.boundingBox();
    return Boolean(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845);
  }).toBe(true);
  await page.mouse.click(2, 2);
  await expect(menu).toHaveCount(0);
});

test("presents Kor and Archetypon pixels without a parallel Canvas primitive renderer", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  await page.evaluate(() => {
    CanvasRenderingContext2D.prototype.fillRect = () => { throw new Error("Canvas must not render pattern primitives."); };
    window.taxis.setParams({ useCells: true, cellShape: "circle", cellGapX: 6, cellGapY: 6, cellSize: 24, width: 320, height: 240 });
  });
  await expect.poll(() => page.locator("canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const expected = window.taxis.render();
    if (canvas.width !== expected.width || canvas.height !== expected.height) return false;
    const actual = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    return actual.every((value, index) => value === expected.pixels[index]);
  })).toBe(true);
  expect(await page.evaluate(() => window.taxis.renderer)).toBe("Kor/Archetypon");
  expect(await page.evaluate(() => [...window.taxis.png().subarray(0, 8)])).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await page.screenshot({ path: "/tmp/taxis-whole-circles.png" });
});
