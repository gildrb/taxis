import { expect, test } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";

test("renders the complete lab and edits geometry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Orb Lab" })).toBeVisible();
  await expect(page.getByLabel("Orb preview and image drop zone")).toBeVisible();
  await expect(page.getByLabel("Orb controls")).toBeVisible();
  await expect(page.getByText(/WebGPU · vgpu|Canvas fallback/)).toBeVisible({ timeout: 15_000 });

  const slices = page.getByRole("slider", { name: "Slices" });
  await slices.fill("40");
  await expect(slices).toHaveValue("40");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(slices).toHaveValue("22");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(slices).toHaveValue("40");
});

test("offers all local export formats and required input types", async ({ page }) => {
  await page.goto("/");
  for (const format of ["SVG", "PNG", "JSON", "WebM", "MP4"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${format}`) })).toBeVisible();
  }
  const fileInput = page.locator('input[type="file"][accept*=".avif"]');
  await expect(fileInput).toHaveCount(1);
  await expect(page.getByText("local processing")).toBeVisible();
});

test("loads an SVG source and exports editable SVG, transparent PNG, and JSON", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"][accept*=".avif"]').setInputFiles("public/sample-glyph.svg");
  await expect(page.getByText("sample-glyph.svg", { exact: true })).toBeVisible();

  for (const format of ["SVG", "PNG", "JSON"] as const) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: format, exact: true }).click();
    const download = await pending;
    const path = await download.path();
    expect(path).not.toBeNull();
    const data = await readFile(path!);
    expect(data.byteLength).toBeGreaterThan(100);
    if (format === "SVG") {
      expect(data.toString()).toContain("<metadata>");
      expect(data.toString()).toMatch(/<(rect|circle) /);
    }
    if (format === "PNG") expect([...data.subarray(1, 4)]).toEqual([80, 78, 71]);
    if (format === "JSON") expect(JSON.parse(data.toString()).app).toBe("Orb Lab");
  }
});

test("encodes downloadable WebM and MP4 loops", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/");
  await page.getByRole("slider", { name: "Duration" }).fill("1");
  await page.getByText("Frame rate").locator("..").getByRole("combobox").selectOption("24");

  for (const format of ["WebM", "MP4"] as const) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: format, exact: true }).click();
    const download = await pending;
    const path = await download.path();
    expect(path).not.toBeNull();
    expect((await stat(path!)).size).toBeGreaterThan(1_000);
  }
});

test("stacks controls below the preview on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const stage = await page.getByLabel("Orb preview and image drop zone").boundingBox();
  const controls = await page.getByLabel("Orb controls").boundingBox();
  expect(stage).not.toBeNull();
  expect(controls).not.toBeNull();
  expect(controls!.y).toBeGreaterThan(stage!.y + stage!.height - 2);
});
