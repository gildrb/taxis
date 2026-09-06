import { describe, expect, test } from "bun:test";
import { DEFAULT_PARAMS } from "../src/model/params";
import { generatePattern, patternToSvg } from "../src/model/pattern";
import { createRadialSource } from "../src/model/source";
import type { CellShape, PatternFrame, PatternParams, PatternPrimitive, RenderInput, SourceData } from "../src/model/types";

function input(overrides: Partial<PatternParams> = {}, source = createRadialSource(64)): RenderInput {
  return { source, params: { ...DEFAULT_PARAMS, useCells: true, sourceMode: "ignore", width: 100, height: 80,
    cellSize: 20, backgroundColor: "#ffffff", colors: ["#111111", "#111111", "#111111", "#111111"], ...overrides } };
}

function allPrimitives(frame: PatternFrame): PatternPrimitive[] {
  const result = [...frame.primitives];
  for (const layer of frame.layers ?? []) result.push(...allPrimitives(layer));
  return result;
}

function expectComplete(frame: PatternFrame): void {
  expect(frame.mask).toBeUndefined();
  expect(frame.masks).toBeUndefined();
  for (const shape of frame.primitives) {
    expect(shape.width).toBeGreaterThan(0);
    expect(shape.height).toBeGreaterThan(0);
    expect(shape.x).toBeGreaterThanOrEqual(-1e-8);
    expect(shape.y).toBeGreaterThanOrEqual(-1e-8);
    expect(shape.x + shape.width).toBeLessThanOrEqual(frame.width + 1e-8);
    expect(shape.y + shape.height).toBeLessThanOrEqual(frame.height + 1e-8);
  }
  for (const layer of frame.layers ?? []) expectComplete(layer);
}

function centers(frame: PatternFrame): number[][] {
  return allPrimitives(frame).map((shape) => [Number((shape.x + shape.width / 2).toFixed(8)), Number((shape.y + shape.height / 2).toFixed(8))]);
}

function polygonArea(points: [number, number][]): number {
  return Math.abs(points.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length]!;
    return sum + x * nextY - y * nextX;
  }, 0)) / 2;
}

describe("whole sampling cells", () => {
  test("cells are the default and continuous scenes require an explicit opt-out", () => {
    expect(DEFAULT_PARAMS.useCells).toBe(true);
    expect(DEFAULT_PARAMS).toMatchObject({ width: 1500, height: 1500, animationTime: 0 });
    const continuous = input({ useCells: false });
    expect(generatePattern({ ...continuous, params: { ...continuous.params, cellShape: "polygon", cellSides: 31,
      cellGapX: 999, cellGapY: 777, cellPadding: 128, cellRotation: 37, cellThreshold: 1 } })).toEqual(generatePattern(continuous));
    const cells = input();
    const frame = generatePattern(cells);
    expect(frame.primitives).toHaveLength(20);
    expect(frame.primitives.every((shape) => shape.width === 20 && shape.height === 20)).toBe(true);
    // Whole blocks do not merge into the continuous bar runs used by the other mode.
    expect(generatePattern(continuous).primitives.length).toBeLessThan(frame.primitives.length);
    for (const preset of ["bars", "candles", "shapes", "stripes", "radial", "rings"] as const) {
      expect(generatePattern({ ...cells, params: { ...cells.params, preset } })).toEqual(frame);
    }
  });

  test("floor fitting centers complete slots on non-divisible canvases", () => {
    const frame = generatePattern(input({ width: 101, height: 81 }));
    expect(frame.primitives).toHaveLength(20);
    expect(frame.primitives[0]).toMatchObject({ x: 0.5, y: 0.5, width: 20, height: 20 });
    expect(frame.primitives.at(-1)).toMatchObject({ x: 80.5, y: 60.5, width: 20, height: 20 });
    expectComplete(frame);
    expect(generatePattern(input({ width: 19, height: 81 })).primitives).toHaveLength(0);
    expect(generatePattern(input({ width: 101, height: 19 })).primitives).toHaveLength(0);
  });

  test("all fitting slots stay whole at many sizes, rather than clipping ceil-grid edges", () => {
    for (const cellSize of [4, 7, 13, 17, 37, 48, 79, 127, 160]) {
      const frame = generatePattern(input({ width: 317, height: 229, cellSize }));
      expect(frame.primitives).toHaveLength(Math.floor(317 / cellSize) * Math.floor(229 / cellSize));
      expect(frame.primitives.every((shape) => shape.width === cellSize && shape.height === cellSize)).toBe(true);
      expectComplete(frame);
    }
  });

  test("gaps change pitch exactly, not shape size", () => {
    const frame = generatePattern(input({ width: 150, height: 110, cellGapX: 10, cellGapY: 6 }));
    expect(frame.primitives).toHaveLength(20);
    const positions = centers(frame);
    expect(positions[1]![0]! - positions[0]![0]!).toBe(30);
    expect(positions[5]![1]! - positions[0]![1]!).toBe(26);
    expect(frame.primitives.every((shape) => shape.width === 20 && shape.height === 20)).toBe(true);
    expect(frame.primitives[0]).toMatchObject({ x: 5, y: 6 });
    expectComplete(frame);
  });

  test("the 400 by 300 reference produces 70 independent triangles with real 52/50 pitches", () => {
    const model = input({ width: 400, height: 300, cellSize: 40, cellShape: "triangle" });
    expect(generatePattern(model).primitives).toHaveLength(70);
    const spaced = generatePattern({ ...model, params: { ...model.params, cellGapX: 12, cellGapY: 10 } });
    expect(spaced.primitives).toHaveLength(42);
    const positions = centers(spaced);
    expect(positions[1]![0]! - positions[0]![0]!).toBe(52);
    expect(positions[7]![1]! - positions[0]![1]!).toBe(50);
  });

  test("fractional cell padding and motif scale shrink shapes without changing pitch", () => {
    const model = input({ cellGapX: 3, cellGapY: 7 });
    const original = generatePattern(model);
    const padded = generatePattern({ ...model, params: { ...model.params, cellPadding: 2.5 } });
    const scaled = generatePattern({ ...model, params: { ...model.params, cellPadding: 2.5, motifScale: 0.5 } });
    expect(centers(padded)).toEqual(centers(original));
    expect(centers(scaled)).toEqual(centers(original));
    expect(padded.primitives.every((shape) => shape.width === 15 && shape.height === 15)).toBe(true);
    expect(scaled.primitives.every((shape) => shape.width === 7.5 && shape.height === 7.5)).toBe(true);
    expect(() => generatePattern(input({ cellPadding: 10 }))).toThrow("Cell padding leaves no shape");
    expect(() => generatePattern(input({ cellPadding: 11 }))).toThrow("Cell padding leaves no shape");
    expect(() => generatePattern(input({ motifScale: 1.1 }))).toThrow("fit their slots");
  });

  for (const cellShape of ["square", "circle", "triangle", "line", "diamond", "hexagon", "octagon", "polygon"] as const) {
    test(`${cellShape} emits one complete shape per slot, not a whole-field clip`, () => {
      const frame = generatePattern(input({ cellShape, cellSides: 11 }));
      expect(frame.primitives).toHaveLength(20);
      expectComplete(frame);
      for (const shape of frame.primitives) {
        if (cellShape === "circle") {
          expect(shape.path?.match(/ A /g)).toHaveLength(2);
          expect(shape.path?.match(/ Z/g)).toHaveLength(1);
          expect(shape).toMatchObject({ width: 20, height: 20 });
        } else if (cellShape === "square" || cellShape === "line") {
          expect(shape.path).toBeUndefined();
          expect(shape.points).toBeUndefined();
          expect(shape.width).toBe(20);
          expect(shape.height).toBe(cellShape === "line" ? 7 : 20);
        } else {
          const count = cellShape === "triangle" ? 3 : cellShape === "diamond" ? 4 : cellShape === "hexagon" ? 6 : cellShape === "octagon" ? 8 : 11;
          expect(shape.points).toHaveLength(count);
          expect(polygonArea(shape.points!)).toBeGreaterThan(0);
        }
      }
      const svg = patternToSvg(input({ cellShape, cellSides: 11 }));
      expect(svg).not.toContain("<mask");
      expect(svg).not.toContain("<clipPath");
      expect(svg).not.toContain("<image");
    });
  }

  test("cell rotation fits the entire shape inside each padded slot", () => {
    for (const cellShape of ["square", "triangle", "line", "diamond", "polygon"] as const) {
      for (const cellRotation of [-173, -90, -45, 17, 89, 180]) {
        const frame = generatePattern(input({ width: 101, height: 81, cellShape, cellSides: 7, cellPadding: 2.3, cellRotation }));
        expect(frame.primitives).toHaveLength(20);
        for (const [index, shape] of frame.primitives.entries()) {
          const slotX = 0.5 + index % 5 * 20;
          const slotY = 0.5 + Math.floor(index / 5) * 20;
          expect(shape.x).toBeGreaterThanOrEqual(slotX + 2.3 - 1e-8);
          expect(shape.y).toBeGreaterThanOrEqual(slotY + 2.3 - 1e-8);
          expect(shape.x + shape.width).toBeLessThanOrEqual(slotX + 17.7 + 1e-8);
          expect(shape.y + shape.height).toBeLessThanOrEqual(slotY + 17.7 + 1e-8);
        }
        expectComplete(frame);
      }
    }
    expect(generatePattern(input({ cellShape: "circle", cellRotation: 45 }))).toEqual(generatePattern(input({ cellShape: "circle" })));
    expect(generatePattern(input({ cellShape: "line", lineWidth: 0.25 })).primitives[0]!.height).toBe(5);
  });
});

describe("whole-cell source and pattern selection", () => {
  test("generated source coverage selects complete squares, including corners outside the disk", () => {
    const frame = generatePattern(input({ sourceMode: "mask", width: 100, height: 100 }));
    expect(frame.primitives).toHaveLength(9);
    expect(frame.primitives.every((shape) => shape.width === 20 && shape.height === 20)).toBe(true);
    expect(frame.primitives[0]).toMatchObject({ x: 20, y: 20, width: 20, height: 20 });
    expect(Math.hypot(frame.primitives[0]!.x - 50, frame.primitives[0]!.y - 50)).toBeGreaterThan(36.5);
    expectComplete(frame);
  });

  test("raster Mask mode uses unadjusted alpha and ignores hidden sampling/background controls", () => {
    const source: SourceData = { width: 3, height: 1, pixels: new Uint8ClampedArray([
      255, 255, 255, 0, 255, 255, 255, 128, 0, 0, 0, 255,
    ]), name: "Native alpha", fingerprint: "alpha-fixture", usesAlpha: true };
    const model = input({ width: 60, height: 20, fit: "stretch", sourceMode: "mask", colorMode: "gradient" }, source);
    const first = generatePattern(model);
    expect(first.primitives.map((shape) => shape.x)).toEqual([20, 40]);
    expect(first.primitives.every((shape) => shape.width === 20 && shape.opacity === 1)).toBe(true);
    expect(generatePattern({ ...model, params: { ...model.params, invert: true, contrast: 0.1, luminanceBias: -1, sourceBackground: 1 } })).toEqual(first);
    expect(generatePattern({ ...model, params: { ...model.params, cellThreshold: 1 } }).primitives.map((shape) => shape.x)).toEqual([40]);
    expect(generatePattern({ ...model, params: { ...model.params, cellThreshold: 0 } }).primitives).toHaveLength(3);
    expectComplete(first);
    const sampled = { ...model, params: { ...model.params, sourceMode: "sample" as const, sampleChannel: "luminance" as const } };
    expect(generatePattern(sampled).primitives.map((shape) => shape.x)).toEqual([20]);
    expect(generatePattern({ ...sampled, params: { ...sampled.params, invert: true } }).primitives.map((shape) => shape.x)).toEqual([40]);
  });

  test("Pattern clip selects centers independently from Cell shape without slicing", () => {
    const all = generatePattern(input({ width: 100, height: 100, cellShape: "triangle" }));
    const selected = generatePattern(input({ width: 100, height: 100, cellShape: "square", maskShape: "circle", maskScale: 0.5 }));
    expect(all.primitives).toHaveLength(25);
    expect(selected.primitives).toHaveLength(5);
    expect(selected.primitives.every((shape) => shape.width === 20 && shape.height === 20)).toBe(true);
    const square = input({ width: 100, height: 100, maskShape: "square", maskScale: 0.6 });
    const unrotated = generatePattern(square);
    const rotated = generatePattern({ ...square, params: { ...square.params, maskRotation: 45 } });
    expect(centers(rotated)).not.toEqual(centers(unrotated));
    expect(rotated.primitives.every((shape) => shape.width === 20 && shape.height === 20 && !shape.points)).toBe(true);
    expectComplete(all);
    expectComplete(selected);
    expectComplete(rotated);
  });

  test("whole-cell alpha selection does not replicate imported SVG clip paths", () => {
    const source: SourceData = { width: 1, height: 1, pixels: new Uint8ClampedArray([255, 255, 255, 255]),
      name: "Native SVG alpha", fingerprint: "native-alpha", usesAlpha: false,
      vectorMask: { viewBox: [0, 0, 1, 1], paths: Array.from({ length: 4096 }, () => ({
        d: "M0 0H1V1H0Z", transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number], fillRule: "nonzero" as const,
      })) } };
    const frame = generatePattern(input({ width: 720, height: 720, layoutColumns: 12, layoutRows: 12, sourceMode: "mask" }, source));
    expect(allPrimitives(frame)).toHaveLength(1296);
    expectComplete(frame);
  });
});

describe("whole-cell transforms and export", () => {
  test("canvas transforms drop complete cells rather than cropping edge fragments", () => {
    const model = input({ width: 100, height: 100 });
    const moved = generatePattern({ ...model, params: { ...model.params, patternOffsetX: 7 } });
    expect(moved.primitives).toHaveLength(20);
    expect(moved.primitives.every((shape) => shape.width === 20 && shape.height === 20)).toBe(true);
    const scaled = generatePattern({ ...model, params: { ...model.params, patternScaleX: 2, patternScaleY: 2 } });
    expect(scaled.primitives).toHaveLength(1);
    expect(scaled.primitives[0]).toMatchObject({ x: 30, y: 30, width: 40, height: 40 });
    const rotated = generatePattern({ ...model, params: { ...model.params, rotation: 45 } });
    expect(rotated.primitives.length).toBeLessThan(25);
    expect(rotated.primitives.length).toBeGreaterThan(0);
    for (const shape of rotated.primitives) {
      expect(shape.points).toHaveLength(4);
      expect(polygonArea(shape.points!)).toBeCloseTo(400, 7);
    }
    expectComplete(moved);
    expectComplete(scaled);
    expectComplete(rotated);
  });

  test("individual repeat transforms cull whole cells at fixed repeat boundaries", () => {
    const model = input({ width: 120, height: 80, layoutColumns: 2, layoutGapX: 10, paddingLeft: 5, paddingRight: 5 });
    const base = generatePattern(model);
    expect(base.layers!.map((layer) => layer.primitives.length)).toEqual([8, 8]);
    const moved = generatePattern({ ...model, params: { ...model.params, layoutCells: [{ index: 0, offsetX: 7 }] } });
    expect(moved.layers!.map((layer) => layer.primitives.length)).toEqual([4, 8]);
    expect(moved.layers![1]).toEqual(base.layers![1]);
    expect(moved.layers![0]!.primitives.every((shape) => shape.x >= 5 && shape.x + shape.width <= 55 && shape.width === 20)).toBe(true);
    const rotated = generatePattern({ ...model, params: { ...model.params, layoutCells: [{ index: 0, rotation: 31 }] } });
    for (const shape of rotated.layers![0]!.primitives) {
      expect(shape.x).toBeGreaterThanOrEqual(5 - 1e-8);
      expect(shape.x + shape.width).toBeLessThanOrEqual(55 + 1e-8);
      expect(shape.points).toHaveLength(4);
      expect(polygonArea(shape.points!)).toBeCloseTo(400, 7);
    }
    expectComplete(moved);
    expectComplete(rotated);
  });

  test("transformed circles remain complete ellipse paths under copy/global shear", () => {
    const model = input({ width: 240, height: 160, cellShape: "circle", cellPadding: 3,
      layoutColumns: 2, layoutGapX: 20, paddingLeft: 10, paddingRight: 10,
      patternScaleX: 1.2, patternScaleY: 0.8, rotation: 17,
      layoutCells: [{ index: 0, rotation: 31, scaleX: 1.1, scaleY: 0.9 }] });
    const frame = generatePattern(model);
    expect(allPrimitives(frame).length).toBeGreaterThan(0);
    for (const layer of frame.layers!) {
      for (const shape of layer.primitives) {
        expect(shape.path?.match(/ A /g)).toHaveLength(2);
        expect(shape.path?.match(/ Z/g)).toHaveLength(1);
        expect(shape.points).toBeUndefined();
      }
    }
    expectComplete(frame);
  });

  test("stagger, seeded jitter and all motion loops stay deterministic and bounded", () => {
    for (const animation of ["none", "pulse", "rotate", "wave"] as const) {
      const model = input({ width: 317, height: 229, cellShape: "hexagon", cellGapX: 3, cellGapY: 5,
        cellPadding: 2, rowShift: 7, rowShiftMode: "wave", jitter: 0.2, seed: 17,
        animation, animationPhase: 0.137, animationDuration: 3.7 });
      const first = generatePattern(model);
      expect(generatePattern(model)).toEqual(first);
      expect(generatePattern({ ...model, time: 3.7 })).toEqual(first);
      expect(generatePattern({ ...model, params: { ...model.params, seed: 19 } })).not.toEqual(first);
      expectComplete(first);
    }
  });

  test("whole-cell slots keep whole-scene safety bounds and serialize editable shapes", () => {
    expect(() => generatePattern(input({ width: 4096, height: 4096, cellSize: 4 }))).toThrow("250,000 cells");
    expect(() => generatePattern(input({ width: 1000, height: 1000, cellSize: 4 }))).toThrow("25,000 shapes");
    expect(generatePattern(input({ width: 4096, height: 4096, cellSize: 4, cellGapX: 100, cellGapY: 100 })).primitives.length).toBeLessThan(25000);
    const source = { ...createRadialSource(64), dataUrl: "data:image/png;base64,private-pixels" };
    for (const cellShape of ["square", "circle", "triangle"] as CellShape[]) {
      const model = input({ cellShape, sourceMode: "mask", width: 100, height: 100 }, source);
      const frame = generatePattern(model);
      const svg = patternToSvg(model);
      expect(svg).not.toContain("<mask");
      expect(svg).not.toContain("<clipPath");
      expect(svg).not.toContain("<image");
      expect(svg).not.toContain("private-pixels");
      expect(svg).toContain("&quot;useCells&quot;:true");
      const tag = cellShape === "square" ? /<rect x=/g : cellShape === "circle" ? /<path /g : /<polygon /g;
      expect(svg.match(tag)).toHaveLength(frame.primitives.length);
    }
  });
});


describe("stable independently animated cell entities", () => {
  test("defaults expose a complete, addressable 1500 by 1500 rest grid", () => {
    const frame = generatePattern({ params: DEFAULT_PARAMS, source: createRadialSource(64) });
    expect(frame).toMatchObject({ width: 1500, height: 1500 });
    expect(frame.entities).toHaveLength(31 * 31);
    expect(frame.entities![0]).toMatchObject({ id: "cell:0:0:0", repeatIndex: 0, row: 0, column: 0,
      rest: { x: 30, y: 30 }, pose: { x: 30, y: 30, scale: 1, rotation: 0, phase: 0 } });
    expect(frame.entities!.at(-1)?.id).toBe("cell:0:30:30");
    expect(new Set(frame.entities!.map((entity) => entity.id)).size).toBe(31 * 31);
    expect(frame.entities!.some((entity) => !entity.selected && entity.primitive === null && entity.hiddenReason === "source")).toBe(true);
    for (const entity of frame.entities!.filter((entity) => entity.visible)) {
      expect(frame.primitives).toContain(entity.primitive!);
      expect(entity.primitive!.entityId).toBe(entity.id);
    }
    expect(generatePattern(input({ useCells: false })).entities).toBeUndefined();
  });

  test("default wave translates each cell vertically with column-staggered phases", () => {
    const model = input({ height: 100, animation: "wave", animationAmount: 0.5, cellPadding: 4 });
    const rest = generatePattern({ ...model, params: { ...model.params, animation: "none" } });
    for (const time of [0, 0.5, 1]) {
      const frame = generatePattern({ ...model, time });
      expect(frame.entities!.map((entity) => [entity.id, entity.rest])).toEqual(rest.entities!.map((entity) => [entity.id, entity.rest]));
      for (const entity of frame.entities!) {
        const displacement = Math.sin((time / 4 + entity.column * 0.1) * Math.PI * 2) * 10;
        expect(entity.pose.x).toBe(entity.rest.x);
        expect(entity.pose.y - entity.rest.y).toBeCloseTo(displacement, 8);
        expect(entity.pose).toMatchObject({ scale: 1, rotation: 0 });
        expect(entity.primitive!.width).toBeCloseTo(12, 8);
        expect(entity.primitive!.height).toBeCloseTo(12, 8);
        expect(entity.primitive!.x + entity.primitive!.width / 2).toBeCloseTo(entity.pose.x, 8);
        expect(entity.primitive!.y + entity.primitive!.height / 2).toBeCloseTo(entity.pose.y, 8);
      }
      const middleRow = frame.entities!.filter((entity) => entity.row === 2);
      expect(middleRow[0]!.pose.y).not.toBe(middleRow[1]!.pose.y);
      expectComplete(frame);
    }
  });

  test("wave axis, phase spacing, and row/index/no stagger are explicit controls", () => {
    for (const animationStaggerBy of ["column", "row", "index", "none"] as const) {
      const frame = generatePattern(input({ height: 100, animation: "wave", animationAxis: "x", animationAmount: 0.5,
        animationStagger: 0.125, animationStaggerBy, animationPhase: 0.25 }));
      for (const entity of frame.entities!) {
        const index = animationStaggerBy === "column" ? entity.column : animationStaggerBy === "row" ? entity.row
          : animationStaggerBy === "index" ? entity.row * 5 + entity.column : 0;
        expect(entity.pose.y).toBe(entity.rest.y);
        expect(entity.pose.x - entity.rest.x).toBeCloseTo(Math.sin((0.25 + 0.125 * index) * Math.PI * 2) * 10, 8);
      }
    }
    const model = input({ animation: "wave", animationStagger: 0, cellPadding: 4 });
    expect(generatePattern(model)).toEqual(generatePattern({ ...model, params: { ...model.params, animationStaggerBy: "none" } }));
  });

  test("pulse scales each body about its own center without scaling grid spacing", () => {
    const model = input({ height: 100, animation: "pulse", animationAmount: 0.5, cellPadding: 4 });
    const before = generatePattern(model);
    const after = generatePattern({ ...model, time: 1 });
    expect(after.primitives).toHaveLength(before.primitives.length);
    for (let index = 0; index < after.entities!.length; index++) {
      const entity = after.entities![index]!;
      expect(entity.rest).toEqual(before.entities![index]!.rest);
      expect({ x: entity.pose.x, y: entity.pose.y }).toEqual(entity.rest);
      expect(entity.pose.scale).toBe(1.5);
      expect(entity.primitive!.width).toBeCloseTo(before.entities![index]!.primitive!.width * 1.5, 8);
      expect(entity.primitive!.height).toBeCloseTo(before.entities![index]!.primitive!.height * 1.5, 8);
    }
    expect(after.entities![1]!.pose.x - after.entities![0]!.pose.x).toBe(20);
    expect(after.entities![5]!.pose.y - after.entities![0]!.pose.y).toBe(20);
    expectComplete(after);
    const collapsed = generatePattern({ ...model, params: { ...model.params, animationAmount: 1 }, time: 3 });
    expect(collapsed.primitives).toHaveLength(0);
    expect(collapsed.entities!.map((entity) => entity.id)).toEqual(before.entities!.map((entity) => entity.id));
    expect(collapsed.entities!.every((entity) => entity.selected && !entity.visible && entity.hiddenReason === "collapsed" && entity.primitive !== null)).toBe(true);
  });

  test("rotation is a rigid local spin, not a field rotation or dynamic slot refit", () => {
    const model = input({ height: 100, cellPadding: 4, animation: "rotate" });
    const before = generatePattern(model);
    const after = generatePattern({ ...model, time: 0.5 });
    for (let index = 0; index < after.entities!.length; index++) {
      const entity = after.entities![index]!;
      expect(entity.rest).toEqual(before.entities![index]!.rest);
      expect({ x: entity.pose.x, y: entity.pose.y }).toEqual(entity.rest);
      expect(entity.pose).toMatchObject({ scale: 1, rotation: 45 });
      expect(polygonArea(entity.primitive!.points!)).toBeCloseTo(12 * 12, 8);
      expect(entity.primitive!.width).toBeCloseTo(12 * Math.SQRT2, 8);
      expect(entity.primitive!.height).toBeCloseTo(12 * Math.SQRT2, 8);
      expect(entity.primitive!.x + entity.primitive!.width / 2).toBeCloseTo(entity.rest.x, 8);
      expect(entity.primitive!.y + entity.primitive!.height / 2).toBeCloseTo(entity.rest.y, 8);
    }
    expect(after.primitives).toHaveLength(before.primitives.length);
    expectComplete(after);
  });

  test("source selection and color remain attached to rest cells as their bodies move", () => {
    const alphaSource: SourceData = { width: 5, height: 1, pixels: new Uint8ClampedArray([
      255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0,
    ]), name: "Rest alpha", fingerprint: "rest-alpha", usesAlpha: true };
    for (const sourceMode of ["sample", "mask"] as const) {
      const model = input({ height: 100, fit: "stretch", sourceMode, sampleChannel: "alpha", cellPadding: 4,
        animation: "wave", animationAxis: "x", animationAmount: 1, animationStaggerBy: "none" }, alphaSource);
      const before = generatePattern(model);
      const after = generatePattern({ ...model, time: 1 });
      expect(after.entities!.map((entity) => [entity.id, entity.rest, entity.selected])).toEqual(before.entities!.map((entity) => [entity.id, entity.rest, entity.selected]));
      const moved = after.entities!.find((entity) => entity.id === "cell:0:2:2")!;
      expect(moved).toMatchObject({ rest: { x: 50, y: 50 }, pose: { x: 70, y: 50 }, selected: true, visible: true });
      expect(after.primitives).toHaveLength(before.primitives.length);
      expectComplete(after);
    }
    const colorSource = { ...alphaSource, pixels: new Uint8ClampedArray(alphaSource.pixels) };
    colorSource.pixels[15] = colorSource.pixels[19] = 255;
    const colored = input({ height: 100, fit: "stretch", sourceMode: "sample", sampleChannel: "alpha", colorMode: "source", cellPadding: 4,
      animation: "wave", animationAxis: "x", animationAmount: 1, animationStaggerBy: "none" }, colorSource);
    const stillColor = generatePattern(colored).entities!.find((entity) => entity.id === "cell:0:2:2")!;
    const movedColor = generatePattern({ ...colored, time: 1 }).entities!.find((entity) => entity.id === stillColor.id)!;
    expect(movedColor.primitive!.color).toBe(stillColor.primitive!.color);
    expect(movedColor.primitive!.color).toBe("rgb(255 0 0)");
  });

  test("pattern clips select rest centers but cannot cut or unselect moving bodies", () => {
    const model = input({ height: 100, maskShape: "circle", maskScale: 0.6, cellPadding: 4,
      animation: "wave", animationAxis: "x", animationAmount: 1, animationStaggerBy: "none" });
    const before = generatePattern(model);
    const after = generatePattern({ ...model, time: 1 });
    expect(after.entities!.map((entity) => [entity.id, entity.selected])).toEqual(before.entities!.map((entity) => [entity.id, entity.selected]));
    const moved = after.entities!.find((entity) => entity.id === "cell:0:2:3")!;
    expect(moved).toMatchObject({ rest: { x: 70, y: 50 }, pose: { x: 90, y: 50 }, selected: true, visible: true });
    expect(moved.primitive!.x + moved.primitive!.width).toBe(96); // Beyond the stationary circle's right edge at80.
    expect(patternToSvg({ ...model, time: 1 })).not.toMatch(/<(?:mask|clipPath) /);
    expectComplete(after);
  });

  test("boundary culling changes explicit visibility, never identity or complete geometry", () => {
    const model = input({ height: 100, animation: "wave", animationAmount: 1, animationStaggerBy: "none" });
    const before = generatePattern(model);
    const after = generatePattern({ ...model, time: 1 });
    expect(before.primitives).toHaveLength(25);
    expect(after.primitives).toHaveLength(20);
    expect(after.entities!.map((entity) => [entity.id, entity.rest, entity.selected])).toEqual(before.entities!.map((entity) => [entity.id, entity.rest, entity.selected]));
    const outside = after.entities!.filter((entity) => !entity.visible);
    expect(outside).toHaveLength(5);
    for (const entity of outside) {
      expect(entity).toMatchObject({ selected: true, hiddenReason: "repeat-bounds", primitive: { y: 100, width: 20, height: 20 } });
      expect(after.primitives).not.toContain(entity.primitive!);
    }
    expectComplete(after);
  });

  test("one addressed override animates only that cell while all other entities remain unchanged", () => {
    const model = input({ height: 100, animation: "none", cellAnimations: [{ id: "cell:0:2:2", animation: "wave",
      animationAxis: "x", animationStaggerBy: "none", animationAmount: 0.5, animationDuration: 2 }] });
    const before = generatePattern(model);
    const after = generatePattern({ ...model, time: 0.5 });
    for (let index = 0; index < after.entities!.length; index++) {
      const entity = after.entities![index]!;
      if (entity.id === "cell:0:2:2") {
        expect(entity.pose).toMatchObject({ x: 60, y: 50, phase: 0.25 });
        expect(entity.primitive).not.toEqual(before.entities![index]!.primitive);
      } else expect(entity).toEqual(before.entities![index]!);
    }
    const inactive = { ...model, params: { ...model.params, cellAnimations: [...model.params.cellAnimations,
      { id: "cell:143:1023:1023", animation: "pulse" as const }] } };
    expect(generatePattern({ ...inactive, time: 0.5 })).toEqual(after);
  });

  test("independent periods and elapsed cursor preserve exact pause, resume, and negative-time evaluation", () => {
    const model = input({ height: 100, cellPadding: 4, animation: "wave", animationDuration: 4,
      cellAnimations: [{ id: "cell:0:2:2", animation: "pulse", animationDuration: 3, animationAmount: 0.5, animationPhase: 0.1 }] });
    const first = generatePattern(model);
    const globalLoop = generatePattern({ ...model, time: 4 });
    const individualLoop = generatePattern({ ...model, time: 3 });
    const id = "cell:0:2:2";
    expect(globalLoop.entities!.find((entity) => entity.id === id)).not.toEqual(first.entities!.find((entity) => entity.id === id));
    expect(individualLoop.entities!.find((entity) => entity.id === id)).toEqual(first.entities!.find((entity) => entity.id === id));
    expect(globalLoop.entities!.filter((entity) => entity.id !== id)).toEqual(first.entities!.filter((entity) => entity.id !== id));
    const paused = { ...model, params: { ...model.params, animationTime: 3.25 } };
    expect(generatePattern(paused)).toEqual(generatePattern({ ...model, time: 3.25 }));
    expect(generatePattern({ ...paused, time: 0.5 })).toEqual(generatePattern({ ...model, time: 3.75 }));
    expect(generatePattern({ ...paused, time: -3.25 })).toEqual(first);
    const svg = patternToSvg({ ...paused, time: 0.5 });
    const metadata = JSON.parse(svg.match(/<metadata>(.*?)<\/metadata>/s)![1]!.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    expect(metadata).toMatchObject({ app: "Taxis", time: 0.5, evaluatedTime: 3.75, params: { animationTime: 3.25 } });
  });

  test("repeat addresses are unique and rest/pose centers and retained geometry are in output space", () => {
    const model = input({ width: 220, height: 100, layoutColumns: 2, layoutGapX: 20, cellPadding: 4,
      cellAnimations: [{ id: "cell:1:2:2", animation: "wave", animationAxis: "x", animationStaggerBy: "none", animationAmount: 0.5 }] });
    const before = generatePattern(model);
    const after = generatePattern({ ...model, time: 1 });
    expect(after.entities).toHaveLength(50);
    expect(new Set(after.entities!.map((entity) => entity.id)).size).toBe(50);
    expect(after.entities![0]!.rest).toEqual({ x: 10, y: 10 });
    expect(after.entities![25]!.rest).toEqual({ x: 130, y: 10 });
    const moved = after.entities!.find((entity) => entity.id === "cell:1:2:2")!;
    expect(moved).toMatchObject({ rest: { x: 170, y: 50 }, pose: { x: 180, y: 50 }, primitive: { x: 174, y: 44, width: 12, height: 12 } });
    expect(after.layers![0]).toEqual(before.layers![0]);
    expect(after.layers![1]!.primitives).toContain(moved.primitive!);
    expect(after.layers!.every((layer) => layer.entities === undefined)).toBe(true);
    const svg = patternToSvg({ ...model, time: 1 });
    const exportedIds = [...svg.matchAll(/data-cell-id="([^"]+)"/g)].map((match) => match[1]);
    expect(exportedIds).toHaveLength(50);
    expect(new Set(exportedIds).size).toBe(50);
    const placed = { ...model, params: { ...model.params, patternScaleX: 0.7, patternScaleY: 0.5, rotation: 25,
      patternOffsetX: 4, patternOffsetY: -7, layoutCells: [{ index: 1, rotation: 31 }] } };
    const placedRest = generatePattern(placed);
    const placedMoving = generatePattern({ ...placed, time: 1 });
    expect(placedRest.entities!.map((entity) => [entity.id, entity.rest, entity.selected])).toEqual(placedMoving.entities!.map((entity) => [entity.id, entity.rest, entity.selected]));
    for (const entity of placedMoving.entities!) {
      if (entity.id !== moved.id) expect({ x: entity.pose.x, y: entity.pose.y }).toEqual(entity.rest);
    }
    expectComplete(placedMoving);
  });
});
