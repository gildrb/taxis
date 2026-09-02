import { describe, expect, test } from "bun:test";
import { adjustedValue, generatePattern, patternToSvg, projectFor } from "../src/model/pattern";
import { createRadialSource, fingerprintPixels, isAcceptedImage, sampleSource } from "../src/model/source";
import { DEFAULT_PARAMS, applyPreset, outputSizeForSource, parsePreset, projectFingerprint } from "../src/model/params";
import type { PatternParams, RenderInput, SourceData } from "../src/model/types";

function params(overrides: Partial<PatternParams> = {}): PatternParams {
  return {
    ...DEFAULT_PARAMS,
    ...overrides,
    colors: overrides.colors ? [...overrides.colors] : [...DEFAULT_PARAMS.colors],
  };
}

function grayscaleSource(width: number, height: number, values: number[], alpha?: number[]): SourceData {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const value = values[index] ?? 0;
    const offset = index * 4;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = alpha?.[index] ?? 255;
  }
  return {
    width,
    height,
    pixels,
    usesAlpha: Boolean(alpha?.some((value) => value < 250)),
    name: "Fixture",
    fingerprint: fingerprintPixels(width, height, pixels),
  };
}

function input(overrides: Partial<PatternParams> = {}, source = createRadialSource(32)): RenderInput {
  return { params: params(overrides), source };
}

describe("deterministic pattern evaluator", () => {
  test("returns identical intermediate geometry for identical inputs", () => {
    const model = input();
    expect(generatePattern(model)).toEqual(generatePattern(model));
    expect(projectFingerprint(model.params, model.source)).toBe(projectFingerprint(model.params, model.source));
  });

  test("maps a 2 by 2 signal into exact vertical candle widths", () => {
    const source = grayscaleSource(2, 2, [0, 255, 255, 0]);
    const frame = generatePattern(input({
      preset: "candles",
      cellSize: 50,
      rowShift: 0,
      width: 100,
      height: 100,
      fit: "stretch",
      colorMode: "custom",
      colorCount: 2,
    }, source));
    expect(frame.primitives.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual([
      { x: 21.875, y: 0, width: 6.25, height: 50 },
      { x: 53.125, y: 0, width: 43.75, height: 50 },
      { x: 3.125, y: 50, width: 43.75, height: 50 },
      { x: 71.875, y: 50, width: 6.25, height: 50 },
    ]);
  });

  test("uses the reference horizontal bar atlas levels", () => {
    const source = grayscaleSource(2, 1, [0, 255]);
    const frame = generatePattern(input({ preset: "bars", cellSize: 50, rowShift: 0, width: 100, height: 50, fit: "stretch" }, source));
    expect(frame.primitives.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual([
      { x: 0, y: 21.875, width: 50, height: 6.25 },
      { x: 50, y: 15.625, width: 50, height: 18.75 },
    ]);
  });

  test("fails fast before an impractical cell grid can freeze the editor", () => {
    expect(() => generatePattern(input({ width: 4096, height: 4096, cellSize: 4 }))).toThrow("250,000 cells");
  });

  test("emits editable SVG from the same primitive frame", () => {
    const model = input({ width: 160, height: 90, cellSize: 30 });
    const frame = generatePattern(model);
    const svg = patternToSvg(model);
    expect(svg).toContain('viewBox="0 0 160 90"');
    expect(svg).toContain("<metadata>");
    expect(svg.match(/<rect /g)?.length).toBe(frame.primitives.length + 1);
    expect(svg).not.toContain("<image");
    expect(projectFor(model).fingerprint).toBe(projectFingerprint(model.params, model.source));
  });
});

describe("source mapping", () => {
  const source = grayscaleSource(4, 1, [0, 85, 170, 255]);

  test("preserves contain, cover, and stretch coordinates", () => {
    const contain = params({ width: 100, height: 100, fit: "contain", scale: 1 });
    expect([12.5, 37.5, 62.5, 87.5].map((x) => sampleSource(source, x, 50, contain).value)).toEqual([0, 85 / 255, 170 / 255, 1]);
    expect(sampleSource(source, 50, 20, contain).alpha).toBe(0);

    const cover = params({ width: 100, height: 100, fit: "cover", scale: 1 });
    expect(sampleSource(source, 0, 50, cover).value).toBe(85 / 255);
    expect(sampleSource(source, 99, 50, cover).value).toBe(170 / 255);

    const stretch = params({ width: 100, height: 100, fit: "stretch", scale: 1 });
    expect(sampleSource(source, 0, 50, stretch).value).toBe(0);
    expect(sampleSource(source, 99, 50, stretch).value).toBe(1);
  });

  test("keeps contain padding empty even when inversion is enabled", () => {
    const settings = params({ width: 100, height: 100, fit: "contain", invert: true });
    const outside = sampleSource(source, 50, 20, settings);
    expect(outside.alpha).toBe(0);
    expect(adjustedValue(outside, settings)).toBe(0);
  });

  test("chooses alpha only for transparent sources", () => {
    const transparent = grayscaleSource(2, 1, [255, 64], [0, 128]);
    const auto = params({ width: 2, height: 1, fit: "stretch", sampleChannel: "auto" });
    expect(sampleSource(transparent, 0.5, 0.5, auto).value).toBe(0);
    expect(sampleSource(transparent, 1.5, 0.5, auto).value).toBe(128 / 255);
    expect(sampleSource(source, 25, 50, params({ width: 100, height: 100, fit: "stretch", sampleChannel: "auto" })).value).toBe(85 / 255);
  });
});

describe("project settings", () => {
  test("applies recipes without mutating the existing palette", () => {
    const first = params();
    const next = applyPreset(first, { colors: ["#000000", "#111111", "#222222", "#333333"] });
    expect(next.colors).not.toBe(first.colors);
    expect(first.colors).toEqual(DEFAULT_PARAMS.colors);
  });

  test("scales tiny sources without changing their aspect ratio", () => {
    expect(outputSizeForSource(grayscaleSource(4, 1, [0, 0, 0, 0]))).toEqual({ width: 256, height: 64 });
  });

  test("imports wrapped settings and rejects malformed values", () => {
    expect(parsePreset({ params: { preset: "candles", cellSize: 28 } }).preset).toBe("candles");
    expect(parsePreset({ width: 1362, height: 468 }).width).toBe(1362);
    expect(() => parsePreset(null)).toThrow();
    expect(() => parsePreset({ preset: "noise" })).toThrow();
    expect(() => parsePreset({ colors: ["#000000"] })).toThrow();
    expect(() => parsePreset({ cellSize: 0 })).toThrow();
    expect(() => parsePreset({ width: 10_000 })).toThrow();
  });

  test("accepts supported source image formats", () => {
    for (const name of ["x.png", "x.jpg", "x.jpeg", "x.webp", "x.avif", "x.svg"]) {
      expect(isAcceptedImage({ name, type: "" } as File)).toBe(true);
    }
    expect(isAcceptedImage({ name: "x.gif", type: "image/gif" } as File)).toBe(false);
  });
});
