import { expect, test } from "@playwright/test";

test("moves real cell geometry in column-staggered waves with stable identities", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  const result = await page.evaluate(() => {
    window.taxis.setParams({
      useCells: true, width: 360, height: 280, cellSize: 28, cellGapX: 6, cellGapY: 6,
      sourceMode: "ignore", cellShape: "square", animation: "wave", animationDuration: 4,
      animationAmount: 0.6, animationAxis: "y", animationStagger: 0.125,
      animationStaggerBy: "column", animationPhase: 0, animationTime: 0,
    });
    const start = window.taxis.evaluate(0).entities!;
    const next = window.taxis.evaluate(0.5).entities!;
    const loop = window.taxis.evaluate(4).entities!;
    return { start, next, loop, svgStart: window.taxis.svg(0), svgNext: window.taxis.svg(0.5) };
  });
  expect(result.start.length).toBeGreaterThan(30);
  expect(result.next.map((entity) => entity.id)).toEqual(result.start.map((entity) => entity.id));
  expect(result.next.map((entity) => entity.selected)).toEqual(result.start.map((entity) => entity.selected));
  expect(result.loop).toEqual(result.start);
  const cells = result.next.filter((entity) => entity.row === 3 && entity.column >= 2 && entity.column <= 5);
  expect(cells).toHaveLength(4);
  for (const entity of cells) {
    expect(entity.visible).toBe(true);
    expect(entity.pose.x).toBeCloseTo(entity.rest.x, 9);
    expect(entity.pose.y - entity.rest.y).toBeCloseTo(Math.sin((0.5 / 4 + entity.column * 0.125) * Math.PI * 2) * 0.6 * 28, 9);
    expect(entity.primitive?.entityId).toBe(entity.id);
  }
  expect(new Set(cells.map((entity) => (entity.pose.y - entity.rest.y).toFixed(6))).size).toBeGreaterThan(2);
  expect(result.svgNext).not.toBe(result.svgStart);
  expect(result.svgNext).toContain('data-cell-id="cell:0:3:3"');
});

test("changes one cell clock without changing neighboring entities", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  const result = await page.evaluate(() => {
    window.taxis.setParams({ useCells: true, width: 320, height: 240, cellSize: 24, sourceMode: "ignore", animation: "wave", animationTime: 0 });
    const before = window.taxis.evaluate(0.5).entities!;
    const id = "cell:0:3:3";
    window.taxis.setParams({ cellAnimations: [{ id, animation: "rotate", animationDuration: 2, animationPhase: 0.17 }] });
    const after = window.taxis.evaluate(0.5).entities!;
    const elapsed = window.taxis.evaluate(0.75);
    window.taxis.setParams({ animationTime: 0.75 });
    const paused = window.taxis.evaluate();
    const project = window.taxis.getScene();
    return { before, after, elapsed, paused, project, id };
  });
  expect(result.before.find((entity) => entity.id === result.id)?.pose).not.toEqual(result.after.find((entity) => entity.id === result.id)?.pose);
  expect(result.before.filter((entity) => entity.id !== result.id)).toEqual(result.after.filter((entity) => entity.id !== result.id));
  expect(result.paused).toEqual(result.elapsed);
  expect(result.project.app).toBe("Taxis");
  expect(result.project.params.animationTime).toBe(0.75);
  expect(result.project.params.cellAnimations).toHaveLength(1);
});


test("plays an individual cell while the all-cells animation is None", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.taxis));
  const before = await page.evaluate(() => {
    window.taxis.setParams({
      useCells: true, width: 320, height: 240, cellSize: 24, sourceMode: "ignore",
      animation: "none", animationTime: 0, animationPhase: 0,
      cellAnimations: [{ id: "cell:0:3:3", animation: "rotate", animationDuration: 2 }],
    });
    return window.taxis.evaluate().entities!.map(({ id, primitive }) => ({ id, primitive }));
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector("canvas")?.dataset.time) > 0.15);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const after = await page.evaluate(() => ({
    time: window.taxis.getScene().params.animationTime,
    canvasTime: Number(document.querySelector("canvas")?.dataset.time),
    cells: window.taxis.evaluate().entities!.map(({ id, primitive }) => ({ id, primitive })),
  }));
  expect(after.time).toBeGreaterThan(0.15);
  expect(after.canvasTime).toBe(after.time);
  expect(after.cells.find((cell) => cell.id === "cell:0:3:3")).not.toEqual(before.find((cell) => cell.id === "cell:0:3:3"));
  expect(after.cells.filter((cell) => cell.id !== "cell:0:3:3")).toEqual(before.filter((cell) => cell.id !== "cell:0:3:3"));
});
