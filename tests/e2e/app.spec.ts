import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("renders the editor shell and edits one deterministic scene", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Pattern Lab/);
  await expect(page.getByLabel("Pattern canvas")).toBeVisible();
  await expect(page.getByLabel("Layers")).toBeVisible();
  await expect(page.getByLabel("Properties")).toBeVisible();
  await expect(page.getByRole("button", { name: "Horizontal", exact: true })).toHaveAttribute("aria-pressed", "true");

  const fingerprint = page.getByTestId("fingerprint");
  const initialFingerprint = await fingerprint.textContent();
  const cellSize = page.getByRole("slider", { name: "Cell Size" });
  await cellSize.fill("28");
  await expect(cellSize).toHaveValue("28");
  await expect(fingerprint).not.toHaveText(initialFingerprint ?? "");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(cellSize).toHaveValue("48");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(cellSize).toHaveValue("28");

  const contrastValue = page.getByRole("spinbutton", { name: "Contrast value" });
  await contrastValue.selectText();
  await contrastValue.pressSequentially("1.25");
  await contrastValue.press("Enter");
  await expect(page.getByRole("slider", { name: "Contrast" })).toHaveValue("1.25");

  const biasValue = page.getByRole("spinbutton", { name: "Luminance Bias value" });
  await biasValue.selectText();
  await biasValue.pressSequentially("-0.25");
  await biasValue.press("Enter");
  await expect(page.getByRole("slider", { name: "Luminance Bias" })).toHaveValue("-0.25");
});

test("groups one slider drag into one undo step", async ({ page }) => {
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "Cell Size" });
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  const start = (box?.x ?? 0) + 4;
  const end = (box?.x ?? 0) + (box?.width ?? 0) - 3;
  await page.mouse.move(start, y);
  await page.mouse.down();
  for (let step = 1; step <= 50; step++) {
    await page.mouse.move(start + (end - start) * (step / 50), y);
  }
  await page.mouse.up();
  expect(Number(await slider.inputValue())).toBeGreaterThan(150);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(slider).toHaveValue("48");
});

test("keeps pending numeric edits separate from range and color transactions", async ({ page }) => {
  await page.goto("/");
  const cellValue = page.getByRole("spinbutton", { name: "Cell Size value" });
  await cellValue.selectText();
  await cellValue.pressSequentially("60");

  const contrast = page.getByRole("slider", { name: "Contrast" });
  const box = await contrast.boundingBox();
  expect(box).not.toBeNull();
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move((box?.x ?? 0) + 4, y);
  await page.mouse.down();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.75, y, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("slider", { name: "Cell Size" })).toHaveValue("60");
  await expect(contrast).toHaveValue("1");

  const color = page.locator('input[name="background-color"]');
  await color.focus();
  for (const value of ["#223344", "#334455", "#445566"]) {
    await color.evaluate((element, next) => {
      (element as HTMLInputElement).value = next;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    await page.waitForTimeout(0);
  }
  await color.blur();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(color).toHaveValue("#f7f6f3");
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


test("fills a resized canvas instead of containing the pattern in the old source aspect", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Source Generated sphere/ }).click();
  await page.getByRole("button", { name: "contain", exact: true }).click();
  await page.getByRole("button", { name: /Canvas 720 × 720/ }).click();
  await page.getByRole("switch", { name: "Transparent" }).click();
  for (const [name, value] of [["Width", "1920"], ["Height", "1080"]] as const) {
    const input = page.getByRole("spinbutton", { name });
    await input.fill(value);
    await input.press("Enter");
  }

  await expect(page.getByLabel("Pattern preview, 1920 by 1080 pixels")).toBeVisible();
  await page.getByRole("button", { name: /Source Generated sphere/ }).click();
  await expect(page.getByRole("button", { name: "cover", exact: true })).toHaveAttribute("aria-pressed", "true");
  const canvas = page.getByLabel("Pattern preview, 1920 by 1080 pixels");
  await expect.poll(() => canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext("2d");
    if (!context) return null;
    const { data, width } = context.getImageData(0, 0, 1920, 1080);
    let minimum = width;
    let maximum = -1;
    for (let offset = 3; offset < data.length; offset += 4) {
      if (data[offset] === 0) continue;
      const x = ((offset - 3) / 4) % width;
      minimum = Math.min(minimum, x);
      maximum = Math.max(maximum, x);
    }
    return [minimum, maximum];
  })).toEqual([0, 1919]);
  await page.getByRole("button", { name: /Pattern Horizontal raster/ }).click();
  await page.getByRole("button", { name: /Light Raster/ }).click();
  await expect(page.getByLabel("Pattern preview, 1920 by 1080 pixels")).toBeVisible();
});

test("preserves a non-square source and exposes fit controls", async ({ page }) => {
  await page.goto("/");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100"><rect width="400" height="100" fill="white"/><text x="20" y="65" font-size="52" fill="black">RASTER</text></svg>`;
  const sourceInput = page.locator('input[type="file"][accept*=".avif"]');
  await sourceInput.setInputFiles({
    name: "wide.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg),
  });
  await expect(sourceInput).toHaveValue("");
  await expect(page.getByLabel("Pattern preview, 400 by 100 pixels")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Pattern preview, 720 by 720 pixels")).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByLabel("Pattern preview, 400 by 100 pixels")).toBeVisible();
  await page.getByRole("slider", { name: "Cell Size" }).fill("20");
  await expect(page.getByRole("button", { name: /Source wide\.svg/ })).toBeVisible();
  await page.getByRole("button", { name: /Sliced Sphere/ }).click();
  await expect(page.getByRole("button", { name: /Source wide\.svg/ })).toBeVisible();
  await expect(page.getByLabel("Pattern preview, 400 by 100 pixels")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Pattern preview, 400 by 100 pixels")).toBeVisible();
  await page.getByRole("button", { name: /Source wide\.svg/ }).click();
  await expect(page.getByTestId("source-summary").getByText(/400 × 100/)).toBeVisible();
  await expect(page.getByRole("button", { name: "cover", exact: true })).toBeVisible();
  await expect(page.getByText(/original aspect ratio/)).toBeVisible();

  const fingerprint = await page.getByTestId("fingerprint").textContent();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Project", exact: true }).click();
  const projectPath = await (await pending).path();
  await page.getByRole("button", { name: "Reset project" }).click();
  await expect(page.getByLabel("Pattern preview, 720 by 720 pixels")).toBeVisible();
  const projectInput = page.locator('input[type="file"][accept*=".json"]');
  await projectInput.setInputFiles(projectPath!);
  await expect(projectInput).toHaveValue("");
  await expect(page.getByLabel("Pattern preview, 400 by 100 pixels")).toBeVisible();
  await expect(page.getByTestId("fingerprint")).toHaveText(fingerprint ?? "");
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
  expect(project.version).toBe(2);
  expect(project.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  expect(project.source.kind).toBe("radial");
});

test("rejects unsupported or malformed project envelopes without changing the scene", async ({ page }) => {
  await page.goto("/");
  const initialFingerprint = await page.getByTestId("fingerprint").textContent();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Project", exact: true }).click();
  const projectPath = await (await pending).path();
  const project = JSON.parse(await readFile(projectPath!, "utf8"));
  const projectInput = page.locator('input[name="project-file"]');

  await projectInput.setInputFiles({
    name: "future.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...project, version: 3 })),
  });
  await expect(page.locator('[role="status"][aria-live]')).toContainText("version is not supported");
  await expect(page.getByTestId("fingerprint")).toHaveText(initialFingerprint ?? "");

  await projectInput.setInputFiles({
    name: "malformed.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...project, source: { ...project.source, dataUrl: 42 } })),
  });
  await expect(page.locator('[role="status"][aria-live]')).toContainText("image data URL");
  await expect(projectInput).toHaveValue("");
  await expect(page.getByTestId("fingerprint")).toHaveText(initialFingerprint ?? "");
});

test("decodes accepted SVG extensions with a generic MIME type", async ({ page }) => {
  await page.goto("/");
  const sourceInput = page.locator('input[name="source-image"]');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="white"/></svg>`;
  await sourceInput.setInputFiles({ name: "generic.svg", mimeType: "application/octet-stream", buffer: Buffer.from(svg) });
  await expect(page.getByRole("button", { name: /Source generic\.svg/ })).toBeVisible();
  await expect(page.getByLabel("Pattern preview, 256 by 128 pixels")).toBeVisible();
});

test("keeps only the latest asynchronous source selection", async ({ page }) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    Object.defineProperty(window, "createImageBitmap", {
      configurable: true,
      value: async (source: ImageBitmapSource) => {
        if (source instanceof File && source.name === "slow.svg") {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return decode(source);
      },
    });
  });
  await page.goto("/");
  const sourceInput = page.locator('input[name="source-image"]');
  const slow = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="black"/></svg>`;
  const fast = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"><rect width="100" height="200" fill="white"/></svg>`;

  await sourceInput.setInputFiles({ name: "slow.svg", mimeType: "image/svg+xml", buffer: Buffer.from(slow) });
  await sourceInput.setInputFiles({ name: "fast.svg", mimeType: "image/svg+xml", buffer: Buffer.from(fast) });
  await expect(page.getByRole("button", { name: /Source fast\.svg/ })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole("button", { name: /Source fast\.svg/ })).toBeVisible();
  await expect(page.getByLabel("Pattern preview, 128 by 256 pixels")).toBeVisible();
});

test("keeps the canvas and bottom-sheet controls usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByLabel("Pattern canvas")).toBeVisible();
  await expect(page.getByLabel("Properties")).toBeVisible();
  const propertiesScroll = page.getByTestId("properties-scroll");
  await propertiesScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await propertiesScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect.poll(() => propertiesScroll.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.getByTestId("source-summary")).toBeVisible();
  await expect(page.getByLabel("Sample")).toBeVisible();
  await page.getByRole("tab", { name: "Canvas", exact: true }).click();
  await expect(page.getByLabel("Width")).toBeVisible();
  await expect(page.getByRole("button", { name: /Export PNG/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport);
    const box = await page.getByTestId("canvas-frame").boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs((box?.width ?? 0) - (box?.height ?? 0))).toBeLessThan(1);
    const properties = await page.getByLabel("Properties").boundingBox();
    expect(properties).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((properties?.y ?? 0) - 4);
  }
});


test("keeps newer recipe edits when an older source decode completes", async ({ page }) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    Object.defineProperty(window, "createImageBitmap", {
      configurable: true,
      value: async (source: ImageBitmapSource) => {
        if (source instanceof File && source.name === "slow.svg") await new Promise((resolve) => setTimeout(resolve, 250));
        return decode(source);
      },
    });
  });
  await page.goto("/");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="white"/></svg>`;
  await page.locator('input[name="source-image"]').setInputFiles({ name: "slow.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await page.getByRole("button", { name: /Sliced Sphere/ }).click();
  await expect(page.getByRole("button", { name: /Source slow\.svg/ })).toBeVisible();
  await expect(page.getByLabel("Pattern preview, 400 by 100 pixels")).toBeVisible();
  await expect(page.getByRole("slider", { name: "Contrast" })).toHaveValue("1.4");
});

test("rebases an in-flight source import around a slider transaction", async ({ page }) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    Object.defineProperty(window, "createImageBitmap", {
      configurable: true,
      value: async (source: ImageBitmapSource) => {
        if (source instanceof File && source.name === "during-drag.svg") await new Promise((resolve) => setTimeout(resolve, 200));
        return decode(source);
      },
    });
  });
  await page.goto("/");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="white"/></svg>`;
  await page.locator('input[name="source-image"]').setInputFiles({ name: "during-drag.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  const slider = page.getByRole("slider", { name: "Cell Size" });
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
  await page.mouse.move((box?.x ?? 0) + 4, y);
  await page.mouse.down();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) * 0.65, y, { steps: 8 });
  await expect(page.getByRole("button", { name: /Source during-drag\.svg/ })).toBeVisible();
  await page.mouse.up();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: /Source during-drag\.svg/ })).toBeVisible();
  await expect(slider).toHaveValue("48");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: /Source Generated sphere/ })).toBeVisible();
});

test("keeps the last successful preview honest while settings exceed the shape guard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Canvas 720 × 720/ }).click();
  const width = page.getByRole("spinbutton", { name: "Width" });
  const height = page.getByRole("spinbutton", { name: "Height" });
  await width.fill("1600");
  await width.press("Enter");
  await height.fill("400");
  await height.press("Enter");
  await page.getByRole("button", { name: /Pattern Horizontal raster/ }).click();
  await page.getByRole("slider", { name: "Cell Size" }).fill("8");
  await expect(page.getByLabel("Pattern preview, 1600 by 400 pixels")).toBeVisible();
  await page.getByRole("button", { name: /Canvas 1600 × 400/ }).click();
  await height.fill("1200");
  await height.press("Enter");
  await expect(page.getByRole("alert")).toContainText("25,000 shapes");
  await expect(page.getByLabel("Pattern preview, 1600 by 400 pixels")).toBeVisible();
  const png = page.getByRole("button", { name: /Export PNG/ });
  await expect(png).toHaveAttribute("aria-disabled", "true");
  await png.click({ force: true });
  await height.fill("400");
  await height.press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator('[role="status"][aria-live]')).toHaveCount(0);
});

test("lays out and keyboard-pans a true two-times canvas zoom", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("canvas-frame");
  const initial = await frame.boundingBox();
  expect(initial).not.toBeNull();
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (let count = 0; count < 10; count++) await zoomIn.click();
  await expect(page.getByLabel("Canvas zoom")).toHaveText("200%");
  await expect(zoomIn).toHaveAttribute("aria-disabled", "true");
  const zoomed = await frame.boundingBox();
  expect(Math.abs((zoomed?.width ?? 0) - (initial?.width ?? 0) * 2)).toBeLessThan(2);
  const viewport = page.getByLabel(/Pattern canvas viewport/);
  await viewport.focus();
  await viewport.press("ArrowDown");
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("keeps short-landscape feedback and controls in natural document flow", async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto("/");
  await page.getByRole("button", { name: "Reset project" }).click();
  const toast = page.locator('[role="status"][aria-live]');
  const toastBox = await toast.boundingBox();
  expect(toastBox).not.toBeNull();
  expect((toastBox?.y ?? 9999)).toBeLessThan(320);
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.locator('section[aria-label="Pattern canvas"]').dispatchEvent("dragenter", { dataTransfer });
  const drop = page.getByText("Drop source image", { exact: true }).locator("..").locator("..");
  const dropBox = await drop.boundingBox();
  expect((dropBox?.height ?? 0)).toBeGreaterThan(80);
  const properties = await page.getByLabel("Properties").boundingBox();
  const footer = await page.locator("main > footer").boundingBox();
  expect((footer?.y ?? 9999) - ((properties?.y ?? 0) + (properties?.height ?? 0))).toBeLessThan(80);
});

test("keeps export focus and restores the real notice trigger", async ({ page }) => {
  await page.goto("/");
  const pngButton = page.getByRole("button", { name: /Export PNG/ });
  await pngButton.focus();
  const pending = page.waitForEvent("download");
  await pngButton.click();
  await pending;
  await expect(pngButton).toBeFocused();

  const reset = page.getByRole("button", { name: "Reset project" });
  await reset.click();
  const dismiss = page.getByRole("button", { name: "Dismiss notification" });
  await dismiss.focus();
  await dismiss.press("Enter");
  await expect(reset).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const rect = active.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && getComputedStyle(active).display !== "none";
  })).toBe(true);
});


test("restores settings, panel, and zoom through URL history", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(50);
  const cell = page.getByRole("slider", { name: "Cell Size" });
  await cell.fill("28");
  await page.waitForTimeout(450);
  await page.getByRole("button", { name: /Source Generated sphere/ }).click();
  await page.waitForTimeout(450);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(450);
  expect(new URL(page.url()).searchParams.get("settings")).toContain('"cellSize":28');
  expect(new URL(page.url()).searchParams.get("panel")).toBe("source");
  expect(new URL(page.url()).searchParams.get("zoom")).toBe("1.1");

  await page.goBack();
  await expect(page.getByLabel("Canvas zoom")).toHaveText("100%");
  await expect(page.getByTestId("source-summary")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: /Pattern Horizontal raster/ })).toHaveAttribute("aria-pressed", "true");
  await expect(cell).toHaveValue("28");
  await page.reload();
  await expect(cell).toHaveValue("28");
});

test("preserves unresolved custom-source provenance across reloads", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(50);
  const initialSourceFingerprint = new URL(page.url()).searchParams.get("source");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="white"/></svg>`;
  await page.locator('input[name="source-image"]').setInputFiles({ name: "linked.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(page.getByRole("button", { name: /Source linked\.svg/ })).toBeVisible();
  await page.getByRole("button", { name: /Canvas 400 × 200/ }).click();
  const width = page.getByRole("spinbutton", { name: "Width" });
  await width.fill("777");
  await width.press("Enter");
  await page.getByRole("button", { name: /Source linked\.svg/ }).click();
  await page.getByRole("slider", { name: "Scale" }).fill("1.6");
  await page.getByRole("slider", { name: "Offset X" }).fill("0.25");
  await expect.poll(() => new URL(page.url()).searchParams.get("source")).not.toBe(initialSourceFingerprint);
  const sourceFingerprint = new URL(page.url()).searchParams.get("source");
  await expect.poll(() => new URL(page.url()).searchParams.get("settings")).toContain('"width":777');
  await expect.poll(() => new URL(page.url()).searchParams.get("settings")).toContain('"scale":1.6');
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.locator('[role="status"][aria-live]')).toContainText("Reopen the original source");
  expect(new URL(page.url()).searchParams.get("source")).toBe(sourceFingerprint);
  await page.reload();
  await expect(page.locator('[role="status"][aria-live]')).toContainText("Reopen the original source");
  expect(new URL(page.url()).searchParams.get("source")).toBe(sourceFingerprint);

  const wrong = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="80"><rect width="40" height="80" fill="black"/></svg>`;
  await page.locator('input[name="source-image"]').setInputFiles({ name: "wrong.svg", mimeType: "image/svg+xml", buffer: Buffer.from(wrong) });
  await expect(page.locator('[role="status"][aria-live]')).toContainText("does not match the linked source");
  expect(new URL(page.url()).searchParams.get("source")).toBe(sourceFingerprint);

  await page.locator('input[name="source-image"]').setInputFiles({ name: "linked.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(page.locator('[role="status"][aria-live]')).toContainText("restored for the linked settings");
  await expect(page.getByRole("button", { name: /Source linked\.svg/ })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Scale" })).toHaveValue("1.6");
  await expect(page.getByRole("slider", { name: "Offset X" })).toHaveValue("0.25");
  await page.getByRole("button", { name: /Canvas 777 × 200/ }).click();
  await expect(page.getByRole("spinbutton", { name: "Width" })).toHaveValue("777");
  expect(new URL(page.url()).searchParams.get("source")).toBe(sourceFingerprint);
});

test("canonicalizes arbitrary linked zoom and warns without rewriting malformed settings", async ({ page }) => {
  await page.goto("/?zoom=0.55");
  await expect(page.getByLabel("Canvas zoom")).toHaveText("60%");
  await expect.poll(() => new URL(page.url()).searchParams.get("zoom")).toBe("0.6");
  await page.reload();
  await expect(page.getByLabel("Canvas zoom")).toHaveText("60%");

  await page.goto("/?settings=%7Bbad");
  await expect(page.locator('[role="status"][aria-live]')).toContainText("does not contain valid Pattern Lab settings");
  expect(new URL(page.url()).searchParams.get("settings")).toBe("{bad");

  await page.goto("/?settings=%7Bbad&source=0123456789abcdef&sourceAlpha=1");
  await expect(page.locator('[role="status"][aria-live]')).toContainText("does not contain valid Pattern Lab settings");
  await expect(page.locator('[role="status"][aria-live]')).not.toContainText("settings were restored");
});


test("keeps legacy linked alpha policy unknown until transparent pixels recover", async ({ page }) => {
  await page.goto("/");
  const transparent = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="200" height="200" fill="white" fill-opacity="0"/><rect x="200" width="200" height="200" fill="white"/></svg>`;
  await page.locator('input[name="source-image"]').setInputFiles({ name: "transparent.svg", mimeType: "image/svg+xml", buffer: Buffer.from(transparent) });
  await expect.poll(() => new URL(page.url()).searchParams.get("sourceAlpha")).toBe("1");
  const fingerprint = await page.getByTestId("fingerprint").textContent();
  const legacyUrl = new URL(page.url());
  legacyUrl.searchParams.delete("sourceAlpha");
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(legacyUrl.toString());
  await expect(page.locator('[role="status"][aria-live]')).toContainText("Reopen the original source");
  expect(new URL(page.url()).searchParams.has("sourceAlpha")).toBe(false);
  await page.reload();
  expect(new URL(page.url()).searchParams.has("sourceAlpha")).toBe(false);

  await page.locator('input[name="source-image"]').setInputFiles({ name: "transparent.svg", mimeType: "image/svg+xml", buffer: Buffer.from(transparent) });
  await expect.poll(() => new URL(page.url()).searchParams.get("sourceAlpha")).toBe("1");
  await expect(page.getByTestId("fingerprint")).toHaveText(fingerprint ?? "");
});


test("restores a linked generated-source alpha policy without requesting a file", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => new URL(page.url()).searchParams.get("source")).not.toBeNull();
  const defaultFingerprint = await page.getByTestId("fingerprint").textContent();
  const alphaUrl = new URL(page.url());
  alphaUrl.searchParams.set("sourceAlpha", "1");
  await page.goto(alphaUrl.toString());
  await expect(page.getByRole("button", { name: /Source Generated sphere/ })).toBeVisible();
  await expect(page.locator('[role="status"][aria-live]')).toHaveCount(0);
  const alphaFingerprint = await page.getByTestId("fingerprint").textContent();
  expect(alphaFingerprint).not.toBe(defaultFingerprint);
  await page.reload();
  await expect(page.getByTestId("fingerprint")).toHaveText(alphaFingerprint ?? "");
  expect(new URL(page.url()).searchParams.get("sourceAlpha")).toBe("1");
});


test("restores each Properties panel scroll position through Back and Forward", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForTimeout(450);
  const scroll = page.getByTestId("properties-scroll");
  await scroll.evaluate((element) => { element.scrollTop = 180; });
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await page.waitForTimeout(450);
  await scroll.evaluate((element) => { element.scrollTop = 70; });
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(40);

  await page.goBack();
  await expect(page.getByRole("tab", { name: "Pattern", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  await page.goForward();
  await expect(page.getByRole("tab", { name: "Source", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(40);
});
