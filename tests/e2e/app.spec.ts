import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("renders the editor shell and edits one deterministic scene", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Pattern Lab/);
  await expect(page.getByLabel("Pattern canvas")).toBeVisible();
  await expect(page.getByLabel("Layers")).toBeVisible();
  await expect(page.getByLabel("Properties")).toBeVisible();
  await expect(page.getByRole("button", { name: "Horizontal", exact: true })).toHaveAttribute("aria-pressed", "true");

  const fingerprint = page.locator(".fingerprint");
  const initialFingerprint = await fingerprint.textContent();
  const cellSize = page.getByRole("slider", { name: "Cell Size" });
  await cellSize.fill("28");
  await expect(cellSize).toHaveValue("28");
  await expect(fingerprint).not.toHaveText(initialFingerprint ?? "");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(cellSize).toHaveValue("48");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(cellSize).toHaveValue("28");
});

test("offers the three reference pattern outcomes as direct recipes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Light Raster/ }).click();
  await expect(page.getByRole("button", { name: "Vertical", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: "Cell Size" })).toHaveValue("12");

  await page.getByRole("button", { name: /Dark Raster/ }).click();
  await expect(page.getByRole("slider", { name: "Cell Size" })).toHaveValue("28");

  await page.getByRole("button", { name: /Sliced Sphere/ }).click();
  await expect(page.getByRole("button", { name: "Horizontal", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("preserves a non-square source and exposes fit controls", async ({ page }) => {
  await page.goto("/");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100"><rect width="400" height="100" fill="white"/><text x="20" y="65" font-size="52" fill="black">RASTER</text></svg>`;
  await page.locator('input[type="file"][accept*=".avif"]').setInputFiles({
    name: "wide.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg),
  });
  await expect(page.getByLabel("Pattern preview, 400 by 100 pixels")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Pattern preview, 720 by 720 pixels")).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByLabel("Pattern preview, 400 by 100 pixels")).toBeVisible();
  await page.getByRole("button", { name: /Source wide\.svg/ }).click();
  await expect(page.locator(".source-summary").getByText(/400 × 100/)).toBeVisible();
  await expect(page.getByRole("button", { name: "cover", exact: true })).toBeVisible();
  await expect(page.getByText(/original aspect ratio/)).toBeVisible();

  const fingerprint = await page.locator(".fingerprint").textContent();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Project", exact: true }).click();
  const projectPath = await (await pending).path();
  await page.getByRole("button", { name: "Reset project" }).click();
  await expect(page.getByLabel("Pattern preview, 720 by 720 pixels")).toBeVisible();
  await page.locator('input[type="file"][accept*=".json"]').setInputFiles(projectPath!);
  await expect(page.getByLabel("Pattern preview, 400 by 100 pixels")).toBeVisible();
  await expect(page.locator(".fingerprint")).toHaveText(fingerprint ?? "");
});

test("exports matching SVG, PNG, and restorable project data", async ({ page }) => {
  await page.goto("/");

  const svgPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "SVG", exact: true }).click();
  const svgPath = await (await svgPending).path();
  const svg = await readFile(svgPath!, "utf8");
  expect(svg).toContain('viewBox="0 0 720 720"');
  expect(svg).toContain("<metadata>");
  expect(svg).not.toContain("<image");

  const pngPending = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export PNG/ }).click();
  const pngPath = await (await pngPending).path();
  const png = await readFile(pngPath!);
  expect([...png.subarray(1, 4)]).toEqual([80, 78, 71]);
  expect(png.readUInt32BE(16)).toBe(720);
  expect(png.readUInt32BE(20)).toBe(720);

  const jsonPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Project", exact: true }).click();
  const jsonPath = await (await jsonPending).path();
  const project = JSON.parse(await readFile(jsonPath!, "utf8"));
  expect(project.app).toBe("Pattern Lab");
  expect(project.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  expect(project.source.kind).toBe("radial");
});

test("keeps the canvas and bottom-sheet controls usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByLabel("Pattern canvas")).toBeVisible();
  await expect(page.getByLabel("Properties")).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.getByLabel("Sample")).toBeVisible();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.getByLabel("Width")).toBeVisible();
  await expect(page.getByRole("button", { name: /Export PNG/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
