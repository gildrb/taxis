import { describe, expect, test } from "bun:test";
import { DEFAULT_PARAMS } from "../src/model/params";
import { generatePattern, patternToSvg, projectFor } from "../src/model/pattern";
import { createRadialSource, maskForSource } from "../src/model/source";
import { parseVectorMask } from "../src/model/svg-mask";
import { createSvgRenderer, type SvgRaster } from "../src/render/native";
import { renderScene } from "../src/render/scene";
import type { PatternFrame, PatternParams, RenderInput, SourceData } from "../src/model/types";

const renderer = await createSvgRenderer(await Bun.file(new URL("../public/renderer/kor.wasm", import.meta.url)).arrayBuffer());

function pixel(raster: SvgRaster, x: number, y: number): number[] {
  const offset = y * raster.stride + x * 4;
  return Array.from(raster.pixels.slice(offset, offset + 4));
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function input(overrides: Partial<PatternParams> = {}, source = createRadialSource(128), time?: number): RenderInput {
  return { params: { ...DEFAULT_PARAMS, ...overrides }, source, time };
}

function rounded(value: number): number {
  return Number(value.toFixed(8));
}

// Compare actual foreground shapes after canvas cropping, never the background-colored atlas cells.
function inkKeys(frame: PatternFrame, mirror: "none" | "x" | "y" = "none"): string[] {
  return frame.primitives.flatMap((shape) => {
    if (shape.opacity <= 0 || shape.color === frame.background) return [];
    const x1 = Math.max(0, shape.x);
    const y1 = Math.max(0, shape.y);
    const x2 = Math.min(frame.width, shape.x + shape.width);
    const y2 = Math.min(frame.height, shape.y + shape.height);
    if (x1 >= x2 || y1 >= y2) return [];
    if (shape.points) {
      const points = shape.points.map(([x, y]) => [rounded(mirror === "x" ? frame.width - x : x),
        rounded(mirror === "y" ? frame.height - y : y)]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
      return [JSON.stringify([points, shape.color, rounded(shape.opacity)])];
    }
    // Ring paths are concentric annuli. Their bounds and inner radius determine their visible ink.
    const innerRadius = shape.path ? Number(shape.path.match(/ Z M [\d.e+-]+ [\d.e+-]+ A ([\d.e+-]+)/)?.[1] ?? 0) : undefined;
    return [JSON.stringify([
      rounded(mirror === "x" ? frame.width - x2 : x1),
      rounded(mirror === "y" ? frame.height - y2 : y1),
      rounded(x2 - x1), rounded(y2 - y1), shape.color, rounded(shape.opacity), innerRadius,
    ])];
  }).sort();
}

function expectMirroredInk(frame: PatternFrame): void {
  const ink = inkKeys(frame);
  expect(ink.length).toBeGreaterThan(0);
  expect(inkKeys(frame, "x")).toEqual(ink);
  expect(inkKeys(frame, "y")).toEqual(ink);
}

describe("intrinsically centered geometry", () => {
  test("defaults have no hidden stagger, enforced mirroring, jitter, or rotation", () => {
    expect(DEFAULT_PARAMS).toMatchObject({ rowShift: 0, rowShiftMode: "alternating",
      symmetry: "none", jitter: 0, rotation: 0, patternOffsetX: 0, patternOffsetY: 0, animation: "none" });
  });

  for (const preset of ["bars", "candles", "shapes", "stripes", "radial", "rings"] as const) {
    test(`${preset}: visible sampled circle ink mirrors at multiple non-divisible output sizes`, () => {
      for (const [width, height, cellSize] of [[713, 529, 47], [701, 457, 33], [159, 157, 48],
        [1362, 468, 37], [1920, 1080, 47], [720, 720, 48]]) {
        const model = input({ preset, width, height, cellSize, sourceMode: "sample" });
        expectMirroredInk(generatePattern(model));
      }
    });
  }

  test("all supported integer cell sizes preserve sampled atlas ink symmetry", () => {
    const source = createRadialSource(127);
    for (const preset of ["bars", "candles", "shapes"] as const) {
      for (let cellSize = 4; cellSize <= 160; cellSize++) {
        const model = input({ preset, width: 317, height: 229, cellSize }, source);
        expectMirroredInk(generatePattern(model));
      }
    }
  });

  test("partial cells are cropped equally and sample both visible midpoints", () => {
    const white: SourceData = { width: 1, height: 1, pixels: new Uint8ClampedArray([255, 255, 255, 255]),
      name: "White", fingerprint: "white", usesAlpha: false };
    const frame = generatePattern(input({ preset: "candles", width: 101, height: 69, cellSize: 40, fit: "stretch" }, white));
    expect(frame.primitives).toHaveLength(6);
    expect(frame.primitives[0]).toMatchObject({ x: -7, y: -5.5, width: 35, height: 40 });
    expectMirroredInk(frame);
    const tiny = generatePattern(input({ preset: "candles", width: 1, height: 1, cellSize: 4, fit: "stretch" }, white));
    expect(tiny.primitives[0]).toMatchObject({ x: -1.25, y: -1.5, width: 3.5, height: 4 });
    expectMirroredInk(tiny);
  });

  test("the highest shape atlas level uses four intrinsically mirrored corner tiles", () => {
    const frame = generatePattern(input({ preset: "shapes", width: 40, height: 40, cellSize: 40, sourceMode: "ignore" }));
    expect(frame.primitives.map(({ x, y, width, height }) => [x, y, width, height])).toEqual([
      [0, 0, 15, 15], [25, 0, 15, 15], [0, 25, 15, 15], [25, 25, 15, 15],
    ]);
    expectMirroredInk(frame);
  });
});

describe("procedural geometry and explicit asymmetry", () => {
  test("equal-paint touching bars become continuous vectors before rotation", () => {
    const model = input({ preset: "bars", sourceMode: "ignore", width: 120, height: 80, cellSize: 20 });
    const flat = generatePattern(model);
    expect(flat.primitives).toHaveLength(4);
    expect(flat.primitives.every((shape) => shape.x === 0 && shape.width === 120 && shape.height === 7.5)).toBe(true);
    const rotated = generatePattern({ ...model, params: { ...model.params, rotation: 23 } });
    expect(rotated.primitives).toHaveLength(4);
    for (const shape of rotated.primitives) {
      const points = shape.points!;
      const area = Math.abs(points.reduce((sum, [x, y], index) => {
        const [nextX, nextY] = points[(index + 1) % points.length]!;
        return sum + x * nextY - y * nextX;
      }, 0)) / 2;
      expect(area).toBeCloseTo(900, 7);
    }
  });

  test("uniform stripes are continuous, equally spaced, with direct duty control", () => {
    const frame = generatePattern(input({ preset: "stripes", width: 173, height: 101, cellSize: 24,
      lineWidth: 0.25, sourceMode: "ignore" }));
    expect(frame.primitives).toHaveLength(5);
    for (const [index, shape] of frame.primitives.entries()) {
      expect(shape).toMatchObject({ x: 0, width: 173, height: 6 });
      if (index > 0) expect(shape.y - frame.primitives[index - 1]!.y).toBe(24);
    }
    expectMirroredInk(frame);
    expect(generatePattern(input({ preset: "stripes", lineWidth: 0.6, sourceMode: "ignore" })).primitives[0]!.height)
      .toBe(DEFAULT_PARAMS.cellSize * 0.6);
  });

  test("radial count, bands, aperture, duty, twist, and taper all change generated vertices", () => {
    const model = input({ preset: "radial", sourceMode: "ignore", radialCount: 12, radialBands: 3 });
    const base = generatePattern(model);
    expect(base.primitives).toHaveLength(36);
    expect(base.primitives.every((shape) => shape.points?.length === 4)).toBe(true);
    for (const change of [{ radialCount: 16 }, { radialBands: 4 }, { innerRadius: 0.4 },
      { lineWidth: 0.7 }, { radialTwist: 18 }, { radialTaper: 0.1 }]) {
      expect(generatePattern({ ...model, params: { ...model.params, ...change } }).primitives).not.toEqual(base.primitives);
    }
    expectMirroredInk(base);
  });

  test("rings have real holes with uniform spacing and independent aperture/duty", () => {
    const model = input({ preset: "rings", width: 240, height: 200, cellSize: 20,
      innerRadius: 0, lineWidth: 0.4, sourceMode: "ignore" });
    const frame = generatePattern(model);
    expect(frame.primitives).toHaveLength(5);
    for (const shape of frame.primitives) {
      expect(shape.path?.match(/ A /g)).toHaveLength(4);
      expect(shape.path).toContain(" 0 1 0 ");
      expect(shape.path).toContain(" 0 1 1 ");
    }
    expect(frame.primitives[1]!.width - frame.primitives[0]!.width).toBe(40);
    expect(generatePattern({ ...model, params: { ...model.params, innerRadius: 0.3 } }).primitives).not.toEqual(frame.primitives);
    expect(generatePattern({ ...model, params: { ...model.params, lineWidth: 0.8 } }).primitives).not.toEqual(frame.primitives);
    expectMirroredInk(frame);
  });

  test("motif scale changes size around cell centers, not cell spacing", () => {
    const model = input({ preset: "candles", width: 120, height: 80, cellSize: 40, sourceMode: "ignore" });
    const original = generatePattern(model);
    const scaled = generatePattern({ ...model, params: { ...model.params, motifScale: 0.5 } });
    for (const [index, before] of original.primitives.entries()) {
      const after = scaled.primitives[index]!;
      expect(after.width).toBe(before.width / 2);
      expect(after.height).toBe(before.height / 2);
      expect(after.x + after.width / 2).toBe(before.x + before.width / 2);
      expect(after.y + after.height / 2).toBe(before.y + before.height / 2);
    }
  });

  test("rotation, offset, stagger, and seeded jitter are opt-in and deterministic", () => {
    const model = input({ width: 157, height: 139, cellSize: 24 });
    const base = generatePattern(model);
    for (const change of [{ rotation: 23 }, { patternOffsetX: 20 }, { patternOffsetY: -15 },
      { rowShift: 9 }, { rowShift: 9, rowShiftMode: "wave" as const }, { jitter: 0.35, seed: 7 }]) {
      const changed = { ...model, params: { ...model.params, ...change } };
      expect(generatePattern(changed)).toEqual(generatePattern(changed));
      expect(inkKeys(generatePattern(changed))).not.toEqual(inkKeys(base));
    }
    expect(generatePattern({ ...model, params: { ...model.params, seed: 9 } })).toEqual(base);
    const jitter = { ...model, params: { ...model.params, jitter: 0.3 } };
    expect(generatePattern({ ...jitter, params: { ...jitter.params, seed: 9 } })).not.toEqual(generatePattern(jitter));
    expect(generatePattern({ ...model, params: { ...model.params, rotation: 23 } }).primitives.some((shape) => shape.points)).toBe(true);
  });

  test("global XY scale and pixel position transform vectors and source mask together", () => {
    const source = vectorSource();
    const sourceBefore = JSON.stringify(source.vectorMask);
    const model = input({ preset: "stripes", sourceMode: "mask", width: 200, height: 100, cellSize: 20,
      lineWidth: 0.5, fit: "stretch", colorMode: "gradient" }, source);
    const original = generatePattern(model);
    const transformed = generatePattern({ ...model, params: { ...model.params,
      patternScaleX: 2, patternScaleY: 0.5, rotation: 90, patternOffsetX: 11, patternOffsetY: -7 } });
    const first = original.primitives[0]!;
    const corners = [[first.x, first.y], [first.x + first.width, first.y],
      [first.x + first.width, first.y + first.height], [first.x, first.y + first.height]];
    expect(transformed.primitives[0]!.points).toEqual(corners.map(([x, y]) => [111 - (y! - 50) * 0.5, 43 + (x! - 100) * 2]));
    expect(transformed.mask!.paths[0]!.transform).toEqual([0, 4, -0.5, 0, 136, -157]);
    expect(transformed.gradient).toEqual(original.gradient); // Deliberately output-space paint.
    expect(JSON.stringify(source.vectorMask)).toBe(sourceBefore);
    expect(patternToSvg({ ...model, params: { ...model.params, patternScaleX: 2 } })).not.toContain("<image");
  });

  test("anisotropic rings stay editable rotated elliptical annuli, not raster bounds", () => {
    const model = input({ preset: "rings", width: 240, height: 200, cellSize: 20,
      innerRadius: 0, lineWidth: 0.4, sourceMode: "ignore" });
    const original = generatePattern(model);
    const stretched = generatePattern({ ...model, params: { ...model.params, patternScaleX: 2, patternScaleY: 0.5 } });
    const rotated = generatePattern({ ...model, params: { ...model.params, patternScaleX: 2, patternScaleY: 0.5, rotation: 90 } });
    expect(stretched.primitives[0]!.width).toBe(original.primitives[0]!.width * 2);
    expect(stretched.primitives[0]!.height).toBe(original.primitives[0]!.height / 2);
    expect(stretched.primitives[0]!.path).toContain("A 28 7 0 1 0");
    expect(rotated.primitives[0]!.width).toBe(stretched.primitives[0]!.height);
    expect(rotated.primitives[0]!.height).toBe(stretched.primitives[0]!.width);
    expect(rotated.primitives[0]!.path).toContain("A 28 7 90 1 0");
  });

  test("source ignore does not depend on pixels and mask mode retains a full procedural field", () => {
    const blank = createRadialSource(4);
    blank.pixels.fill(0);
    const model = input({ sourceMode: "ignore" });
    expect(generatePattern({ ...model, source: blank })).toEqual(generatePattern(model));
    const masked = generatePattern({ ...model, params: { ...model.params, sourceMode: "mask" } });
    expect(masked.primitives).toEqual(generatePattern(model).primitives);
    expect(masked.mask?.paths.length).toBeGreaterThan(0);
  });

  test("procedural mask/ignore fields ignore stale sampling adjustments", () => {
    const source = createRadialSource(128);
    for (const sourceMode of ["mask", "ignore"] as const) {
      for (const preset of ["bars", "candles", "shapes", "stripes", "radial", "rings"] as const) {
        const model = input({ sourceMode, preset }, source);
        const stale = { ...model, params: { ...model.params, invert: true, contrast: 0.1, luminanceBias: -1 } };
        expect(generatePattern(stale)).toEqual(generatePattern(model));
        const gradient = generatePattern({ ...stale, params: { ...stale.params, colorMode: "gradient" } });
        expect(gradient.primitives.length).toBeGreaterThan(0);
        expect(gradient.primitives.every((shape) => shape.opacity === 1)).toBe(true);
      }
    }
  });

  test("grid and radial safety budgets fail before building huge primitive arrays", () => {
    expect(() => generatePattern(input({ width: 4096, height: 4096, cellSize: 4 }))).toThrow("250,000 cells");
    expect(() => generatePattern(input({ preset: "shapes", width: 1200, height: 1200, cellSize: 8 }))).toThrow("25,000 shapes");
    expect(() => generatePattern(input({ preset: "radial", radialCount: 360, radialBands: 80 }))).toThrow("25,000 shapes");
  });
});

describe("geometric masks and independent form layout", () => {
  test("built-in masks and their own rotation/scale do not rotate motif geometry", () => {
    const model = input({ sourceMode: "ignore", preset: "stripes", width: 200, height: 160 });
    const base = generatePattern(model);
    expect(base.layers).toBeUndefined();
    expect(base.mask).toBeUndefined();
    for (const maskShape of ["circle", "triangle", "square", "octagon", "polygon"] as const) {
      const masked = generatePattern({ ...model, params: { ...model.params, maskShape } });
      const rotated = generatePattern({ ...model, params: { ...model.params, maskShape, maskRotation: 23, maskScale: 0.7 } });
      expect(masked.primitives).toEqual(base.primitives);
      expect(rotated.primitives).toEqual(base.primitives);
      expect(masked.mask?.paths).toHaveLength(1);
      expect(rotated.mask).not.toEqual(masked.mask);
      expect(masked.background).toBe(base.background);
    }
  });

  test("source and geometric masks intersect but preserve independent transforms", () => {
    const model = input({ sourceMode: "mask", maskShape: "triangle", width: 200, height: 100 }, vectorSource());
    const first = generatePattern(model);
    const rotated = generatePattern({ ...model, params: { ...model.params, maskRotation: 31 } });
    expect(first.mask).toEqual(maskForSource(model.source, model.params));
    expect(first.masks).toHaveLength(1);
    expect(rotated.mask).toEqual(first.mask);
    expect(rotated.masks).not.toEqual(first.masks);
    expect(rotated.primitives).toEqual(first.primitives);
  });

  test("subdivision computes exact padding and gaps with output-space child frames", () => {
    const frame = generatePattern(input({ preset: "stripes", sourceMode: "ignore", width: 317, height: 229,
      cellSize: 14, lineWidth: 1, layoutColumns: 2, layoutRows: 2, layoutGapX: 13, layoutGapY: 17,
      paddingTop: 11, paddingRight: 7, paddingBottom: 5, paddingLeft: 3 }));
    expect(frame.primitives).toHaveLength(0);
    expect(frame.layers).toHaveLength(4);
    for (const [index, layer] of frame.layers!.entries()) {
      const left = 3 + (index % 2) * 160;
      const top = 11 + Math.floor(index / 2) * 115;
      expect(layer).toMatchObject({ width: 317, height: 229, background: null });
      expect(layer.layers).toBeUndefined();
      expect(layer.primitives[0]).toMatchObject({ x: left, y: top, width: 147, height: 14 });
      expect(layer.mask).toMatchObject({ viewBox: [0, 0, 317, 229], paths: [
        { d: "M 0 0 H 147 V 98 H 0 Z", transform: [1, 0, 0, 1, left, top] },
      ] });
    }
  });

  test("global scale and pulse stretch form spacing after layout", () => {
    const model = input({ preset: "stripes", sourceMode: "ignore", width: 317, height: 229,
      layoutColumns: 2, layoutRows: 2, layoutGapX: 13, layoutGapY: 17,
      paddingTop: 11, paddingRight: 7, paddingBottom: 5, paddingLeft: 3,
      patternScaleX: 2, patternScaleY: 0.5, patternOffsetX: 5, patternOffsetY: -7 });
    const frame = generatePattern(model);
    const first = frame.layers![0]!.mask!.paths[0]!.transform;
    const right = frame.layers![1]!.mask!.paths[0]!.transform;
    const below = frame.layers![2]!.mask!.paths[0]!.transform;
    expect(right[4] - first[4] - 147 * first[0]).toBe(26);
    expect(below[5] - first[5] - 98 * first[3]).toBe(8.5);
    const pulse = generatePattern({ ...model, params: { ...model.params, animation: "pulse", animationPhase: 0.25, animationAmount: 0.2 } });
    const pulseFirst = pulse.layers![0]!.mask!.paths[0]!.transform;
    const pulseRight = pulse.layers![1]!.mask!.paths[0]!.transform;
    expect(pulseRight[4] - pulseFirst[4] - 147 * pulseFirst[0]).toBeCloseTo(26 * 1.2, 10);
  });

  test("each individual control changes only its form and inactive overrides stay dormant", () => {
    const model = input({ sourceMode: "ignore", preset: "stripes", width: 240, height: 120,
      layoutColumns: 2, layoutGapX: 20, paddingLeft: 10, paddingRight: 10, maskShape: "square" });
    const base = generatePattern(model);
    for (const change of [{ offsetX: 7 }, { offsetY: -9 }, { scaleX: 0.6 }, { scaleY: 0.8 }, { rotation: 31 },
      { maskRotation: 17 }, { maskScale: 0.6 }, { maskShape: "triangle" as const }, { padding: 9 }]) {
      const frame = generatePattern({ ...model, params: { ...model.params, layoutCells: [{ index: 1, ...change }] } });
      expect(frame.layers![0]).toEqual(base.layers![0]);
      expect(frame.layers![1]).not.toEqual(base.layers![1]);
    }
    const dormant = { ...model, params: { ...model.params, layoutCells: [{ index: 3, offsetX: 11 }] } };
    expect(generatePattern(dormant)).toEqual(base);
    const expanded = generatePattern({ ...dormant, params: { ...dormant.params, layoutColumns: 4 } });
    const expandedBase = generatePattern({ ...model, params: { ...model.params, layoutColumns: 4 } });
    expect(expanded.layers![0]).toEqual(expandedBase.layers![0]);
    expect(expanded.layers![3]).not.toEqual(expandedBase.layers![3]);
    expect(generatePattern({ ...model, params: { ...model.params, layoutColumns: 1, layoutCells: [{ index: 0 }] } }))
      .toEqual(generatePattern({ ...model, params: { ...model.params, layoutColumns: 1 } }));
  });

  test("layout padding errors and whole-scene budgets fail before form allocation", () => {
    expect(() => generatePattern(input({ width: 100, paddingLeft: 60, paddingRight: 40 }))).toThrow("padding and gaps");
    expect(() => generatePattern(input({ width: 100, layoutColumns: 2, layoutGapX: 100 }))).toThrow("padding and gaps");
    expect(() => generatePattern(input({ width: 100, layoutColumns: 2, layoutCells: [{ index: 1, padding: 25 }] }))).toThrow("Form 2 padding");
    const model = input({ preset: "radial", sourceMode: "ignore", radialCount: 128, radialBands: 16 });
    expect(generatePattern(model).primitives).toHaveLength(2048);
    expect(() => generatePattern({ ...model, params: { ...model.params, layoutColumns: 12, layoutRows: 2 } })).toThrow("25,000 shapes");
    const unsupported = { ...model.source, kind: undefined, vectorMask: undefined };
    expect(() => generatePattern({ source: unsupported, params: { ...model.params, sourceMode: "mask", layoutColumns: 12, layoutRows: 2 } })).toThrow("25,000 shapes");
  });

  test("repeated SVG masks share the scene-wide path count and character limits", () => {
    const source = vectorSource();
    source.vectorMask = { viewBox: [0, 0, 100, 100], paths: [{
      d: `M0 0${" L1 1".repeat(6000)} Z`, transform: [1, 0, 0, 1, 0, 0], fillRule: "nonzero",
    }] };
    expect(() => generatePattern(input({ sourceMode: "mask", preset: "radial", radialCount: 3, radialBands: 1,
      layoutColumns: 12, layoutRows: 12 }, source))).toThrow("4 million mask path characters");
    source.vectorMask.paths = Array.from({ length: 4096 }, () => ({ d: "M0 0H10V10H0Z",
      transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number], fillRule: "nonzero" as const }));
    expect(() => generatePattern(input({ sourceMode: "mask", preset: "radial", radialCount: 3, radialBands: 1,
      layoutColumns: 7 }, source))).toThrow("25,000 shapes or mask paths");
  });

  test("annuli remain exact ellipses after local rotation and global anisotropic shear", () => {
    const frame = generatePattern(input({ preset: "rings", sourceMode: "ignore", width: 240, height: 120,
      cellSize: 20, lineWidth: 0.4, innerRadius: 0, layoutColumns: 2, layoutGapX: 20,
      paddingTop: 10, paddingRight: 10, paddingBottom: 10, paddingLeft: 10,
      patternScaleX: 2, patternScaleY: 0.5, rotation: -17,
      layoutCells: [{ index: 0, rotation: 31, scaleX: 1.3, scaleY: 0.7 }] }));
    const layer = frame.layers![0]!;
    const [a, b, c, d, e, f] = layer.mask!.paths[0]!.transform;
    const shape = layer.primitives[0]!;
    const arc = shape.path!.match(/ A ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) 1 0/)!;
    const rx = Number(arc[1]);
    const ry = Number(arc[2]);
    const angle = Number(arc[3]) * Math.PI / 180;
    const radius = 14;
    expect(rx * ry).toBeCloseTo(radius * radius * Math.abs(a * d - b * c), 8);
    expect(shape.width).toBeCloseTo(2 * radius * Math.hypot(a, c), 10);
    expect(shape.height).toBeCloseTo(2 * radius * Math.hypot(b, d), 10);
    const cx = a * 50 + c * 50 + e;
    const cy = b * 50 + d * 50 + f;
    for (const theta of [0, 0.37, 0.9, 2.5]) {
      const x = 50 + radius * Math.cos(theta);
      const y = 50 + radius * Math.sin(theta);
      const dx = a * x + c * y + e - cx;
      const dy = b * x + d * y + f - cy;
      const u = (Math.cos(angle) * dx + Math.sin(angle) * dy) / rx;
      const v = (-Math.sin(angle) * dx + Math.cos(angle) * dy) / ry;
      expect(u * u + v * v).toBeCloseTo(1, 9);
    }
  });

  test("repeated default circle fields stay symmetric on fractional cell layouts", () => {
    const frame = generatePattern(input({ width: 317, height: 229, layoutColumns: 3, layoutRows: 2,
      layoutGapX: 13, layoutGapY: 17, paddingTop: 11, paddingRight: 11, paddingBottom: 11, paddingLeft: 11, cellSize: 17 }));
    expectMirroredInk({ ...frame, primitives: frame.layers!.flatMap((layer) => layer.primitives) });
    const moving = input({ layoutColumns: 2, maskShape: "octagon", animation: "rotate", animationDuration: 3.7 });
    expect(generatePattern({ ...moving, time: 0 })).toEqual(generatePattern({ ...moving, time: 3.7 }));
  });

  test("layer SVG IDs are unique and native rendering intersects union masks per form", () => {
    const model = input({ preset: "stripes", sourceMode: "mask", colorMode: "gradient", maskShape: "triangle",
      width: 200, height: 100, cellSize: 20, layoutColumns: 2 }, vectorSource());
    const frame = generatePattern(model);
    const svg = patternToSvg(model);
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(8); // Two gradients + three intersecting masks per form.
    expect(new Set(ids).size).toBe(ids.length);
    for (const reference of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(reference[1]);
    expect(svg.match(/data-layer=/g)).toHaveLength(2);
    expect(svg.match(/<rect width="200" height="100"/g)).toHaveLength(1);
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("data:image");
    for (const index of [0, 1]) {
      expect(svg).toContain(`<g mask="url(#layer-${index}-source-mask-2)">
  <g mask="url(#layer-${index}-source-mask-1)">
  <g mask="url(#layer-${index}-source-mask)">`);
    }
    expect(svg.match(/fill-rule="evenodd"/g)).toHaveLength(2);
    expect(svg.match(/fill-rule="nonzero"/g)).toHaveLength(6);
    // Each form's union mask is intersected with its triangle and layout bounds.
    const raster = renderScene(model, renderer, "rgba");
    const unmasked = renderScene({ ...model, params: { ...model.params, sourceMode: "ignore", maskShape: "none" } }, renderer, "rgba");
    const background = [...rgb(frame.background!), 255];
    for (const offset of [0, 100]) {
      expect(pixel(raster, offset + 45, 50)).toEqual(pixel(unmasked, offset + 45, 50));
      expect(pixel(raster, offset + 45, 50)).not.toEqual(background);
      expect(pixel(raster, offset + 25, 50)).toEqual(background); // Hole not covered by union.
      expect(pixel(raster, offset + 5, 50)).toEqual(background); // Source ink outside triangle.
    }
  });
});

describe("deterministic looping motion", () => {
  for (const animation of ["pulse", "rotate", "wave"] as const) {
    for (const preset of ["bars", "radial", "rings"] as const) {
      test(`${animation}/${preset} wraps exactly at its duration and accepts negative time`, () => {
        const model = input({ preset, sourceMode: "ignore", animation, animationPhase: 0.137,
          animationDuration: 3.7, animationAmount: 0.3 });
        const first = generatePattern({ ...model, time: 0 });
        expect(generatePattern({ ...model, time: 3.7 })).toEqual(first);
        expect(generatePattern({ ...model, time: 3.7 * 5 })).toEqual(first);
        expect(generatePattern({ ...model, time: -3.7 })).toEqual(first);
        // Rotating truly concentric rings has no visible effect, as expected.
        if (animation !== "rotate" || preset !== "rings") {
          expect(generatePattern({ ...model, time: 0.7 })).not.toEqual(first);
        }
        const firstSvg = patternToSvg({ ...model, time: 0 });
        const loopSvg = patternToSvg({ ...model, time: 3.7 });
        expect(loopSvg.replace(/<metadata>.*?<\/metadata>/s, "")).toBe(firstSvg.replace(/<metadata>.*?<\/metadata>/s, ""));
      });
    }
  }

  test("SVG records the requested frame time without changing the scene project", () => {
    const model = input({ animation: "rotate", animationPhase: 0.25 });
    const svg = patternToSvg({ ...model, time: 1.375 });
    const text = svg.match(/<metadata>(.*?)<\/metadata>/s)![1]!
      .replaceAll("&quot;", '"').replaceAll("&apos;", "'")
      .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
    const metadata = JSON.parse(text);
    expect(metadata.time).toBe(1.375);
    expect(metadata.params.animationPhase).toBe(0.25);
    expect(projectFor({ ...model, time: 1.375 })).toEqual(projectFor(model));
    expect(patternToSvg(model)).toContain("&quot;time&quot;:0");
  });

  test("phase plus elapsed time equals a fixed scrubbed phase; none ignores time", () => {
    const model = input({ sourceMode: "ignore", animation: "pulse", animationPhase: 0.1, animationDuration: 4 });
    expect(generatePattern({ ...model, time: 1 })).toEqual(generatePattern({ ...model, params: { ...model.params, animationPhase: 0.35 } }));
    const still = input();
    expect(generatePattern({ ...still, time: 3 })).toEqual(generatePattern(still));
    expect(() => generatePattern({ ...still, time: Number.NaN })).toThrow("finite");
  });
});

function vectorSource(): SourceData {
  return {
    ...createRadialSource(100), kind: undefined, name: "Union.svg", dataUrl: "data:image/png;base64,private-pixels",
    vectorMask: { viewBox: [0, 0, 100, 100], paths: [
      { d: "M0 0H60V100H0Z M10 10H50V90H10Z", transform: [1, 0, 0, 1, 0, 0], fillRule: "evenodd" },
      { d: "M40 20H90V80H40Z", transform: [1, 0, 0, 1, 3, 2], fillRule: "nonzero" },
    ] },
  };
}

describe("native SVG paint and vector-mask geometry", () => {
  test("sampled gradients color only the adjusted signal and retain source alpha", () => {
    const source: SourceData = { width: 3, height: 1, pixels: new Uint8ClampedArray([
      0, 0, 0, 255, 128, 128, 128, 128, 255, 255, 255, 255,
    ]), usesAlpha: true, name: "Signal", fingerprint: "signal" };
    const model = input({ preset: "bars", width: 120, height: 40, cellSize: 40, fit: "stretch",
      colorMode: "gradient", sampleChannel: "luminance" }, source);
    const frame = generatePattern(model);
    expect(frame.primitives.map((shape) => shape.x)).toEqual([40, 80]);
    expect(frame.primitives[0]!.opacity).toBeCloseTo((128 / 255) ** 2, 12);
    expect(frame.primitives[1]!.opacity).toBe(1);
    const adjusted = generatePattern({ ...model, params: { ...model.params, contrast: 2, luminanceBias: -0.25 } });
    expect(adjusted.primitives[0]!.opacity).toBeCloseTo(((128 / 255 - 0.5) * 2 + 0.5 - 0.25 * 0.35) * 128 / 255, 12);
    expect(generatePattern({ ...model, params: { ...model.params, invert: true } }).primitives.map((shape) => shape.x)).toEqual([0, 40]);
    const circle = generatePattern(input({ colorMode: "gradient", width: 317, height: 229, cellSize: 17 }));
    expectMirroredInk(circle);
    expect(Math.min(...circle.primitives.map((shape) => shape.x))).toBeGreaterThan(0);
    expect(Math.max(...circle.primitives.map((shape) => shape.x + shape.width))).toBeLessThan(circle.width);
    expect(patternToSvg(model).match(/fill="url\(#pattern-gradient\)"/g)).toHaveLength(2);
    const raster = renderScene(model, renderer, "rgba");
    const opaque = renderScene({ ...model, params: { ...model.params, sourceMode: "ignore" } }, renderer, "rgba");
    const background = rgb(frame.background!);
    expect(pixel(raster, 20, 20)).toEqual([...background, 255]);
    for (const shape of frame.primitives) {
      const x = Math.floor(shape.x + shape.width / 2);
      const y = Math.floor(shape.y + shape.height / 2);
      const paint = pixel(opaque, x, y);
      const actual = pixel(raster, x, y);
      for (let channel = 0; channel < 3; channel++) {
        const expected = background[channel]! * (1 - shape.opacity) + paint[channel]! * shape.opacity;
        expect(Math.abs(actual[channel]! - expected)).toBeLessThanOrEqual(2);
      }
      expect(actual[3]).toBe(255);
    }
  });

  for (const type of ["linear", "radial"] as const) {
    test(`${type} gradients retain whole-canvas coordinates and native paint stops`, () => {
      const model = input({ preset: "stripes", sourceMode: "ignore", colorMode: "gradient", gradientType: type,
        width: 200, height: 100, gradientStart: "#123456", gradientEnd: "#abcdef", gradientAngle: 27,
        gradientCenterX: 0.2, gradientCenterY: -0.1, gradientSpan: 0.7 });
      const frame = generatePattern(model);
      expect(frame.primitives.every((shape) => shape.color === "url(#pattern-gradient)")).toBe(true);
      const gradient = frame.gradient!;
      const svg = patternToSvg(model);
      expect(svg).toContain(`gradientUnits="userSpaceOnUse"`);
      expect(svg).toContain(`<${type}Gradient id="pattern-gradient"`);
      expect(svg).toContain('stop-color="#123456"');
      expect(svg).toContain('stop-color="#abcdef"');
      expect(svg.match(/fill="url\(#pattern-gradient\)"/g)).toHaveLength(frame.primitives.length);
      const tag = svg.match(new RegExp(`<${type}Gradient[^>]+>`))![0];
      const coordinates = type === "linear"
        ? { x1: gradient.x1, y1: gradient.y1, x2: gradient.x2, y2: gradient.y2 }
        : { cx: gradient.x2, cy: gradient.y2, r: gradient.radius, fx: gradient.x1, fy: gradient.y1 };
      for (const [name, value] of Object.entries(coordinates)) {
        expect(Number(tag.match(new RegExp(`\\b${name}="([^"]+)"`))![1])).toBeCloseTo(value, 3);
      }
      expect(svg).toContain('<stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#abcdef"/>');
      const raster = renderScene(model, renderer, "rgba");
      // Sample fully covered stripe interiors, away from antialiased boundaries.
      const y = Math.floor(frame.primitives[1]!.y + frame.primitives[1]!.height / 2);
      for (const x of [10, 70, 130, 190]) {
        const dx = gradient.x2 - gradient.x1;
        const dy = gradient.y2 - gradient.y1;
        const t = Math.max(0, Math.min(1, type === "linear"
          ? ((x + 0.5 - gradient.x1) * dx + (y + 0.5 - gradient.y1) * dy) / (dx * dx + dy * dy)
          : Math.hypot(x + 0.5 - gradient.x2, y + 0.5 - gradient.y2) / gradient.radius));
        const actual = pixel(raster, x, y);
        const start = rgb(gradient.start);
        const end = rgb(gradient.end);
        for (let channel = 0; channel < 3; channel++) {
          expect(Math.abs(actual[channel]! - (start[channel]! * (1 - t) + end[channel]! * t))).toBeLessThanOrEqual(2);
        }
        expect(actual[3]).toBe(255);
      }
    });
  }

  test("mask paths retain independent rules and transforms, union natively, and never mask the background", () => {
    const model = input({ preset: "stripes", sourceMode: "mask", width: 200, height: 100,
      colorMode: "gradient", fit: "stretch" }, vectorSource());
    const frame = generatePattern(model);
    expect(frame.mask).toEqual(maskForSource(model.source, model.params));
    const svg = patternToSvg(model);
    expect(svg).toContain('maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"');
    expect(svg).toContain('mask-type="alpha"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('fill-rule="nonzero"');
    expect(svg).toContain('<g mask="url(#source-mask)">');
    expect(svg.indexOf(`<rect width="200" height="100" fill="${frame.background}"`)).toBeLessThan(svg.indexOf('<g mask='));
    expect(svg).not.toContain("<clipPath");
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("private-pixels");
    expect(svg).not.toContain("data:image");
    expect(projectFor(model)).toMatchObject({ version: 3, source: { vectorMask: parseVectorMask(model.source.vectorMask) } });
    expect(svg).toContain("vectorMask");
    for (const path of frame.mask!.paths) {
      const transform = svg.match(new RegExp(`d="${path.d}" transform="matrix\\(([^)]+)\\)"`))![1]!;
      const values = transform.split(" ").map(Number);
      for (const [index, value] of path.transform.entries()) expect(values[index]).toBeCloseTo(value, 3);
    }
    const raster = renderScene(model, renderer, "rgba");
    const unmasked = renderScene({ ...model, params: { ...model.params, sourceMode: "ignore" } }, renderer, "rgba");
    const background = [...rgb(frame.background!), 255];
    for (const [x, visible] of [[10, true], [50, false], [90, true], [150, true], [195, false]] as const) {
      // x=90 is inside the first path's hole, but the translated second path fills it.
      expect(pixel(raster, x, 50)).toEqual(visible ? pixel(unmasked, x, 50) : background);
      if (visible) expect(pixel(raster, x, 50)).not.toEqual(background);
    }
    expect(renderScene(model, renderer, "rgba").pixels).toEqual(raster.pixels);
  });

  test("native SVG draws polygons and annular paths rather than their bounding boxes", () => {
    for (const preset of ["radial", "rings", "bars"] as const) {
      const model = input({ preset, sourceMode: "ignore", rotation: 19, width: 200, height: 200 });
      const frame = generatePattern(model);
      const svg = patternToSvg(model);
      expect(svg.match(preset === "rings" ? /<path /g : /<polygon /g)).toHaveLength(frame.primitives.length);
      expect(svg.match(/<rect /g)).toHaveLength(1); // Background only.
      const raster = renderScene(model, renderer, "rgba");
      const background = [...rgb(frame.background!), 255];
      const first = frame.primitives[0]!;
      if (preset === "rings") {
        expect(pixel(raster, 100, 100)).toEqual(background); // Actual annular hole.
        expect(pixel(raster, Math.floor(first.x + first.width - 3), 100)).not.toEqual(background);
      } else {
        const points = first.points!;
        const cx = Math.floor(points.reduce((sum, point) => sum + point[0], 0) / points.length);
        const cy = Math.floor(points.reduce((sum, point) => sum + point[1], 0) / points.length);
        expect(pixel(raster, cx, cy)).not.toEqual(background);
      }
      // A bounding-box renderer must produce a different image, not just different SVG tags.
      let shapeIndex = 0;
      const boxes = svg.replace(/<(?:polygon|path) [^>]+\/>/g, () => {
        const shape = frame.primitives[shapeIndex++]!;
        return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${shape.color}"/>`;
      });
      const document = renderer.createDocument(boxes);
      try { expect(document.render(200, 200).pixels).not.toEqual(raster.pixels); }
      finally { document.dispose(); }
    }
  });
});


describe("portable native scene contract", () => {
  test("RGBA, PNG, and editable SVG share the same deterministic timed scene", () => {
    const model = input({ preset: "radial", sourceMode: "ignore", width: 96, height: 80,
      radialCount: 12, radialBands: 2, rotation: 17, transparent: true,
      animation: "wave", animationDuration: 4, animationAmount: 0.3 }, createRadialSource(32), 0.75);
    const raster = renderScene(model, renderer, "rgba");
    const png = renderScene(model, renderer, "png");
    const svg = renderScene(model, renderer, "svg");
    expect(raster).toMatchObject({ width: 96, height: 80, stride: 384 });
    expect(raster.pixels).toHaveLength(96 * 80 * 4);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(header.getUint32(16)).toBe(96);
    expect(header.getUint32(20)).toBe(80);
    const text = new TextDecoder().decode(svg);
    expect(text).toBe(patternToSvg(model));
    expect(text).toContain("<polygon ");
    expect(text).not.toContain("<image");
    const document = renderer.createDocument(svg);
    try {
      expect(document.render(96, 80).pixels).toEqual(raster.pixels);
      expect(document.png(96, 80)).toEqual(png);
    } finally { document.dispose(); }
    const alphas = raster.pixels.filter((_, index) => index % 4 === 3);
    expect(alphas.some((alpha) => alpha === 0)).toBe(true);
    expect(alphas.some((alpha) => alpha === 255)).toBe(true);
    expect(renderScene(model, renderer, "rgba")).toEqual(raster);
    expect(renderScene(model, renderer, "png")).toEqual(png);
    expect(renderScene(model, renderer, "svg")).toEqual(svg);
    expect(renderScene({ ...model, time: 4.75 }, renderer, "rgba")).toEqual(raster);
    expect(renderScene({ ...model, time: 1.75 }, renderer, "rgba").pixels).not.toEqual(raster.pixels);
  });
});
