import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { PatternProject } from "../../src/model/types";
import { chooseOption } from "./menu";
import { downloadExport } from "./export";

async function exportText(page: Page, button: string): Promise<string> {
  const path = await (await downloadExport(page, button === "Export Project" ? "json" : "svg")).path();
  return readFile(path!, "utf8");
}

async function expectSvgMatchesCanvas(page: Page, svg: string) {
  const difference = await page.locator("canvas").evaluate(async (element, markup) => {
    const preview = element as HTMLCanvasElement;
    const source = preview.getContext("2d")!.getImageData(0, 0, preview.width, preview.height).data;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = preview.width;
    canvas.height = preview.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const target = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let difference = 0;
    let changed = 0;
    for (let index = 0; index < source.length; index++) {
      const delta = Math.abs(source[index]! - target[index]!);
      difference += delta;
      if (delta > 8) changed++;
    }
    // Different rasterizers use different edge coverage. Require agreement away
    // from the SVG reference's one-pixel edge band, not identical AA coverage.
    let interiorChanged = 0;
    for (let y = 1; y < canvas.height - 1; y++) {
      for (let x = 1; x < canvas.width - 1; x++) {
        const offset = (y * canvas.width + x) * 4;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1 && !edge; dx++) {
            const neighbor = ((y + dy) * canvas.width + x + dx) * 4;
            for (let channel = 0; channel < 4; channel++) {
              if (Math.abs(target[offset + channel]! - target[neighbor + channel]!) > 4) { edge = true; break; }
            }
          }
        }
        if (!edge && [0, 1, 2, 3].some((channel) => Math.abs(source[offset + channel]! - target[offset + channel]!) > 8)) interiorChanged++;
      }
    }
    return { mean: difference / source.length, changed: changed / source.length, interiorChanged };
  }, svg);
  expect(difference.mean).toBeLessThan(1.5);
  expect(difference.interiorChanged).toBe(0);
}

test("centers default ink in both axes at uneven canvas and cell sizes", async ({ page }) => {
  for (const settings of [{ width: 720, height: 720, cellSize: 48 }, { width: 511, height: 377, cellSize: 29 }]) {
    await page.goto(`/?settings=${encodeURIComponent(JSON.stringify({ ...settings, useCells: false }))}`);
    const canvas = page.locator("canvas");
    await expect(canvas).toHaveAttribute("data-phase", "0");
    const symmetry = await canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const { data, width, height } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      let horizontal = 0;
      let vertical = 0;
      let ink = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const value = data[(y * width + x) * 4]!;
        if (value < 80) ink++;
        horizontal += Math.abs(value - data[(y * width + width - 1 - x) * 4]!);
        vertical += Math.abs(value - data[((height - 1 - y) * width + x) * 4]!);
      }
      return { horizontal: horizontal / (width * height), vertical: vertical / (width * height), ink };
    });
    expect(symmetry.ink).toBeGreaterThan(100);
    expect(symmetry.horizontal).toBeLessThan(0.1);
    expect(symmetry.vertical).toBeLessThan(0.1);
  }
});

test("exposes independent center-origin vector transforms without changing Cell Size", async ({ page }) => {
  await page.goto("/");
  for (const [name, value] of [["Position X", "42"], ["Position Y", "-25"], ["Scale X", "0.65"], ["Scale Y", "1.2"], ["Rotation", "30"]]) {
    await page.getByRole("slider", { name: name!, exact: true }).fill(value!);
  }
  await expect(page.getByRole("slider", { name: "Cell Size", exact: true })).toHaveValue("48");
  const project = JSON.parse(await exportText(page, "Export Project")) as PatternProject;
  expect(project.params).toMatchObject({ patternOffsetX: 42, patternOffsetY: -25, patternScaleX: 0.65, patternScaleY: 1.2, rotation: 30, cellSize: 48 });
  const svg = await exportText(page, "SVG");
  expect(svg).toContain("<polygon");
  expect(svg).not.toContain("<image");
  await expectSvgMatchesCanvas(page, svg);
  await page.waitForFunction(() => Boolean(window.taxis));
  const fingerprint = await page.evaluate(() => window.taxis.getScene().fingerprint);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.taxis?.getScene().fingerprint)).toBe(fingerprint);
  await expect(page.getByRole("slider", { name: "Scale X", exact: true })).toHaveValue("0.65");
  await page.screenshot({ path: "/tmp/taxis-transform.png" });
});

test("keeps imported SVG masks vector-based through gradients, transforms, and project restore", async ({ page }) => {
  await page.goto("/");
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><g transform="translate(20 20)"><path d="M0 0H50V140H0Z"/><path fill-rule="evenodd" d="M90 0H280V140H90ZM130 35V105H240V35Z"/></g></svg>`;
  await page.locator('input[name="source-image"]').setInputFiles({ name: "vector-outline.svg", mimeType: "image/svg+xml", buffer: Buffer.from(source) });
  await expect(page.getByRole("button", { name: /Source vector-outline/ })).toBeVisible();
  await chooseOption(page, "Recipe", "Masked Stripes");
  await page.getByRole("slider", { name: "Cell Size", exact: true }).fill("16");
  await chooseOption(page, "Mode", "Gradient");
  await page.getByRole("slider", { name: "Scale X", exact: true }).fill("0.8");
  await page.getByRole("slider", { name: "Scale Y", exact: true }).fill("0.9");
  await page.getByRole("slider", { name: "Rotation", exact: true }).fill("12");
  const svg = await exportText(page, "SVG");
  expect(svg).toContain('<mask id="source-mask"');
  expect(svg).toContain("<linearGradient");
  expect(svg).toContain('fill-rule="evenodd"');
  expect(svg).not.toContain("<image");
  await expectSvgMatchesCanvas(page, svg);
  const projectText = await exportText(page, "Export Project");
  const project = JSON.parse(projectText) as PatternProject;
  expect(project.source.vectorMask?.paths).toHaveLength(2);
  await page.waitForFunction(() => Boolean(window.taxis));
  const fingerprint = await page.evaluate(() => window.taxis.getScene().fingerprint);
  const pixels = await page.locator("canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  await page.getByRole("button", { name: "Reset project" }).click();
  await page.locator('input[name="project-file"]').setInputFiles({ name: "vector-project.json", mimeType: "application/json", buffer: Buffer.from(projectText) });
  await expect(page.locator('[role="status"][aria-live]')).toContainText("Project restored");
  await expect.poll(() => page.evaluate(() => window.taxis?.getScene().fingerprint)).toBe(fingerprint);
  expect(await page.locator("canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())).toBe(pixels);
  await page.screenshot({ path: "/tmp/taxis-vector-mask.png" });
});

test("replays animation phases exactly and exports the paused frame", async ({ page }) => {
  await page.goto("/");
  await chooseOption(page, "Recipe", "Radial Rays");
  await chooseOption(page, "Mode", "Gradient");
  await chooseOption(page, "Gradient type", "Radial");
  await chooseOption(page, "Animation", "Pulse");
  const canvas = page.locator("canvas");
  await expect(canvas).toHaveAttribute("data-phase", "0");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const timeline = page.locator("summary").filter({ hasText: /^Timeline & phase$/ });
  await timeline.click();
  const phase = page.getByRole("slider", { name: "Loop phase", exact: true });
  await phase.fill("0.25");
  await expect(canvas).toHaveAttribute("data-phase", "0.25");
  const quarter = await canvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  await phase.fill("0.75");
  await expect(canvas).toHaveAttribute("data-phase", "0.75");
  expect(await canvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())).not.toBe(quarter);
  await phase.fill("0.25");
  await expect(canvas).toHaveAttribute("data-phase", "0.25");
  expect(await canvas.evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())).toBe(quarter);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(canvas).not.toHaveAttribute("data-time", "0");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const stoppedTime = Number(await canvas.getAttribute("data-time"));
  expect(stoppedTime).toBeGreaterThan(0);
  await expect(phase).toHaveValue("0.25");
  const svg = await exportText(page, "SVG");
  await expectSvgMatchesCanvas(page, svg);
  const text = await exportText(page, "Export Project");
  const project = JSON.parse(text) as PatternProject;
  expect(project.params.animationTime).toBe(stoppedTime);
  expect(project.params.animationPhase).toBe(0.25);
  expect(project.params.animation).toBe("pulse");
  await page.getByRole("button", { name: "Reset project" }).click();
  await page.locator('input[name="project-file"]').setInputFiles({ name: "motion.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(canvas).toHaveAttribute("data-time", String(stoppedTime));
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expectSvgMatchesCanvas(page, svg);
  await page.screenshot({ path: "/tmp/taxis-radial-motion.png" });
  if (!await phase.isVisible()) await timeline.click();
  await page.getByRole("button", { name: "Reset timeline", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-time", "0");
  await expect(phase).toHaveValue("0");
  expect((await page.evaluate(() => window.taxis.getScene())).params).toMatchObject({ animationTime: 0, animationPhase: 0 });
});

test("lets agents inspect, edit, render, and restore the exact same scene as the UI", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  const edited = await page.evaluate(() => {
    const api = window.taxis;
    api.setParams({ useCells: false, preset: "radial", sourceMode: "ignore", colorMode: "gradient", patternScaleX: 0.7, patternScaleY: 1.15, rotation: 28 });
    api.setParams({ patternOffsetX: 42, patternOffsetY: -18 });
    return { scene: api.getScene(), scaleRule: api.schema.properties.patternScaleX, svg: api.svg(0), first: api.evaluate(0), second: api.evaluate(0) };
  });
  expect(edited.scene.params).toMatchObject({ preset: "radial", patternScaleX: 0.7, patternScaleY: 1.15, patternOffsetX: 42, patternOffsetY: -18, rotation: 28 });
  expect(edited.scaleRule).toMatchObject({ type: "number", minimum: 0.1, maximum: 4 });
  expect(edited.first).toEqual(edited.second);
  await expect(page.getByRole("slider", { name: "Position X", exact: true })).toHaveValue("42");
  await expect(page.getByRole("slider", { name: "Scale X", exact: true })).toHaveValue("0.7");
  await expectSvgMatchesCanvas(page, edited.svg);
  expect(await exportText(page, "SVG")).toBe(edited.svg);
  const saved = await page.evaluate(() => window.taxis.getScene());
  await page.getByRole("button", { name: "Reset project" }).click();
  const immediate = await page.evaluate(async (scene) => {
    const restored = await window.taxis.setScene(scene);
    return { restored, current: window.taxis.getScene() };
  }, saved);
  expect(immediate.restored).toEqual(saved);
  expect(immediate.current).toEqual(saved);
  await expect(page.getByRole("slider", { name: "Rotation", exact: true })).toHaveValue("28");
  const failed = await page.evaluate(() => {
    const before = window.taxis.getScene().fingerprint;
    const messages: string[] = [];
    for (const patch of [{ patternScaleX: 0 }, { positonX: 2 }, { params: { rotation: 45 } }]) {
      try { window.taxis.setParams(patch); } catch (error) { messages.push((error as Error).message); }
    }
    return { before, after: window.taxis.getScene().fingerprint, messages };
  });
  expect(failed.messages).toHaveLength(3);
  expect(failed.after).toBe(failed.before);
  await page.reload();
  await expect(page.getByRole("slider", { name: "Rotation", exact: true })).toHaveValue("28");
});

test("lets agents import SVG source geometry without operating file-picker UI", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  const result = await page.evaluate(async () => {
    const source = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="10 20 100 100"><rect x="10" y="20" width="100" height="100"/></svg>'], "offset-mask.svg", { type: "image/svg+xml" });
    await window.taxis.setSource(source);
    const scene = window.taxis.setParams({ useCells: false, preset: "stripes", sourceMode: "mask", cellSize: 12, lineWidth: 0.5 });
    return { scene, svg: window.taxis.svg() };
  });
  expect(result.scene.source.vectorMask?.paths).toHaveLength(1);
  expect(result.scene.params).toMatchObject({ width: 256, height: 128, sourceMode: "mask" });
  await expect(page.locator("canvas")).toHaveAttribute("width", "256");
  await expectSvgMatchesCanvas(page, result.svg);
  const bounds = await page.locator("canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const { data, width, height } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let left = width;
    let right = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4]! < 80) { left = Math.min(left, x); right = Math.max(right, x); }
    }
    return [left, right];
  });
  expect(bounds).toEqual([64, 191]);
});

test("imports a scene while playing without stale-state cancellation", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  const saved = await page.evaluate(() => window.taxis.setParams({ useCells: false, preset: "radial", sourceMode: "ignore", animation: "pulse", animationPhase: 0.25, animationTime: 0.75 }));
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("canvas")).not.toHaveAttribute("data-time", "0.75");
  await page.evaluate(async (scene) => { await window.taxis.setScene(scene); }, saved);
  await expect(page.locator("canvas")).toHaveAttribute("data-time", "0.75");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("composes masked vector forms in a padded grid with independent cell overrides", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  const output = await page.evaluate(() => {
    const scene = window.taxis.setParams({
      useCells: false, width: 600, height: 400, preset: "stripes", sourceMode: "ignore", cellSize: 14,
      lineWidth: 0.45, maskShape: "triangle", maskScale: 0.85, colorMode: "gradient",
      layoutColumns: 3, layoutRows: 2, layoutGapX: 18, layoutGapY: 26,
      paddingTop: 20, paddingRight: 30, paddingBottom: 20, paddingLeft: 30,
      layoutCells: [{ index: 1, maskRotation: 180, offsetY: 6 }, { index: 4, maskShape: "octagon", scaleX: 0.8, rotation: 18, padding: 8 }],
    });
    return { scene, svg: window.taxis.svg(), frame: window.taxis.evaluate() };
  });
  expect(output.frame.layers).toHaveLength(6);
  expect(output.scene.params.layoutCells).toHaveLength(2);
  expect(output.svg).not.toContain("<image");
  const idCounts = await page.evaluate((svg) => {
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    return { total: ids.length, unique: new Set(ids).size, masks: document.querySelectorAll("mask").length };
  }, output.svg);
  expect(idCounts.unique).toBe(idCounts.total);
  expect(idCounts.masks).toBeGreaterThanOrEqual(6);
  await expectSvgMatchesCanvas(page, output.svg);
  const initial = await page.locator("canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
  await page.evaluate(() => { window.taxis.setParams({ layoutCells: [] }); });
  expect(await page.locator("canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())).not.toBe(initial);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => page.locator("canvas").evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())).toBe(initial);
  const restored = await page.evaluate(async (scene) => {
    await window.taxis.setScene(scene);
    return window.taxis.svg();
  }, output.scene);
  expect(restored).toBe(output.svg);
  await page.screenshot({ path: "/tmp/taxis-layout.png" });
});

test("keeps independently rotated masks and rings vector-exact under global anisotropic scale", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  const svg = await page.evaluate(() => {
    window.taxis.setParams({
      useCells: false, width: 560, height: 420, preset: "rings", sourceMode: "ignore", cellSize: 10,
      maskShape: "square", maskRotation: 25, maskScale: 0.8,
      layoutColumns: 2, layoutRows: 2, layoutGapX: 18, layoutGapY: 22,
      paddingTop: 30, paddingRight: 35, paddingBottom: 30, paddingLeft: 35,
      patternScaleX: 0.8, patternScaleY: 1.1, rotation: 12,
      layoutCells: [{ index: 0, scaleX: 0.8, scaleY: 1.2, rotation: 35 }, { index: 2, maskShape: "circle", offsetX: 10 }],
    });
    return window.taxis.svg();
  });
  await expectSvgMatchesCanvas(page, svg);
  expect(svg).toContain("<path");
  expect(svg).not.toContain("<image");
});

test("edits whole-pattern clips and repeat spacing through product controls", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  await page.evaluate(() => { window.taxis.setParams({ useCells: false, preset: "stripes", sourceMode: "ignore" }); });
  await page.locator("summary").filter({ hasText: /^Pattern clip$/ }).click();
  await chooseOption(page, "Pattern clip", "Triangle");
  await page.locator("summary").filter({ hasText: /^Repeat pattern$/ }).click();
  const columns = page.getByRole("spinbutton", { name: "Repeat columns", exact: true });
  await columns.fill("3");
  await columns.press("Enter");
  await page.getByText("Repeat spacing & outer padding", { exact: true }).click();
  await page.getByRole("slider", { name: "Repeat gap X", exact: true }).fill("24");
  await page.getByRole("slider", { name: "Canvas padding left", exact: true }).fill("18");
  await page.getByText("Individual repeat", { exact: true }).click();
  await chooseOption(page, "Repeat selector", "2: Row 1, column 2");
  await page.getByRole("slider", { name: "Repeat clip rotation", exact: true }).fill("180");
  const repeatX = page.getByRole("spinbutton", { name: "Repeat position X", exact: true });
  await repeatX.fill("12");
  await repeatX.press("Enter");
  await page.getByRole("slider", { name: "Repeat padding", exact: true }).fill("6");
  const scene = await page.evaluate(() => window.taxis.getScene());
  expect(scene.params).toMatchObject({ maskShape: "triangle", layoutColumns: 3, layoutGapX: 24, paddingLeft: 18 });
  expect(scene.params.layoutCells).toEqual([{ index: 1, offsetX: 12, maskRotation: 180, padding: 6 }]);
  await page.evaluate(() => { window.taxis.setParams({ layoutCells: [...window.taxis.getScene().params.layoutCells, { index: 5, rotation: 12 }] }); });
  await page.getByRole("button", { name: "Reset selected repeat", exact: true }).click();
  expect((await page.evaluate(() => window.taxis.getScene())).params.layoutCells).toEqual([{ index: 5, rotation: 12 }]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await page.evaluate(() => window.taxis.getScene())).params.layoutCells).toHaveLength(2);
});
