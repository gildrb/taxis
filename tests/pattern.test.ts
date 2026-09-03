import { describe, expect, test } from "bun:test";
import { adjustedValue, generatePattern, patternToSvg, projectFor } from "../src/model/pattern";
import { parseProject } from "../src/model/project";
import { createRadialSource, fingerprintPixels, isAcceptedImage, legacyFingerprintPixels, sampleSource } from "../src/model/source";
import { DEFAULT_PARAMS, PRESETS, applyPreset, outputSizeForSource, parsePreset, projectFingerprint, legacyProjectFingerprint } from "../src/model/params";
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

  test("samples the visible midpoint of partial edge cells", () => {
    const source = grayscaleSource(1, 1, [255]);
    const frame = generatePattern(input({ preset: "candles", cellSize: 4, width: 1, height: 1, fit: "stretch" }, source));
    expect(frame.primitives[0]).toMatchObject({ x: 0.25, width: 3.5 });
  });

  test("does not draw custom motifs for transparent or out-of-fit samples", () => {
    const source = grayscaleSource(1, 1, [255], [0]);
    const frame = generatePattern(input({ cellSize: 4, width: 4, height: 4, fit: "stretch", transparent: true }, source));
    expect(frame.background).toBeNull();
    expect(frame.primitives).toHaveLength(0);
  });

  test("fails fast before an impractical cell grid can freeze the editor", () => {
    expect(() => generatePattern(input({ width: 4096, height: 4096, cellSize: 4 }))).toThrow("250,000 cells");
    expect(() => generatePattern(input({ width: 2000, height: 2000, cellSize: 4, preset: "shapes", colorMode: "source", sourceBackground: 1 }))).toThrow("25,000 shapes");
  });

  test("emits editable SVG from the same primitive frame without embedding source pixels", () => {
    const { kind: _kind, ...radial } = createRadialSource();
    const model = input({ width: 160, height: 90, cellSize: 30 }, { ...radial, dataUrl: "data:image/png;base64,private-source" });
    const frame = generatePattern(model);
    const svg = patternToSvg(model);
    expect(svg).toContain('viewBox="0 0 160 90"');
    expect(svg).toContain("<metadata>");
    expect(svg.match(/<rect /g)?.length).toBe(frame.primitives.length + 1);
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("private-source");
    expect(projectFor(model).fingerprint).toBe(projectFingerprint(model.params, model.source));
  });
});

test("uses full-bleed source placement for default widescreen canvases", () => {
  expect(DEFAULT_PARAMS.fit).toBe("cover");
  expect(PRESETS.find((recipe) => recipe.name === "Sliced Sphere")?.params.fit).toBe("cover");
  const frame = generatePattern({
    params: params({ width: 1920, height: 1080, transparent: true }),
    source: createRadialSource(),
  });
  expect(Math.min(...frame.primitives.map((primitive) => primitive.x))).toBe(0);
  expect(Math.max(...frame.primitives.map((primitive) => primitive.x + primitive.width))).toBe(1920);
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

  test("uses a 64-bit pixel fingerprint that separates known FNV-32 collisions", () => {
    const first = new Uint8ClampedArray([42, 228, 34, 255, 202, 29, 53, 255]);
    const second = new Uint8ClampedArray([52, 118, 155, 255, 214, 142, 21, 255]);
    expect(legacyFingerprintPixels(2, 1, first)).toBe(legacyFingerprintPixels(2, 1, second));
    expect(fingerprintPixels(2, 1, first)).not.toBe(fingerprintPixels(2, 1, second));
    expect(fingerprintPixels(2, 1, first)).toMatch(/^[0-9a-f]{16}$/);
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
  test("applies recipes without mutating the existing palette or canvas size", () => {
    const first = params({ width: 1920, height: 1080 });
    const palette = applyPreset(first, { colors: ["#000000", "#111111", "#222222", "#333333"] });
    expect(palette.colors).not.toBe(first.colors);
    expect(first.colors).toEqual(DEFAULT_PARAMS.colors);
    for (const recipe of PRESETS) {
      const next = applyPreset(first, recipe.params);
      expect({ width: next.width, height: next.height }).toEqual({ width: 1920, height: 1080 });
    }
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

  test("validates project versions, fingerprints, and embedded source types", () => {
    const exported = projectFor(input({}, createRadialSource(4)));
    const parsed = parseProject(exported);
    expect(parsed.fingerprint).toBe(exported.fingerprint);
    expect(parsed.version).toBe(2);
    expect(parsed.source?.size).toBe(4);
    expect(parseProject({ params: { cellSize: 24 } }).source).toBeUndefined();
    expect(() => parseProject({ ...exported, version: 3 })).toThrow("version is not supported");
    expect(() => parseProject({ ...exported, params: null })).toThrow("valid pattern settings");
    expect(() => parseProject({ ...exported, fingerprint: exported.fingerprint.toUpperCase() })).toThrow("project fingerprint");
    expect(() => parseProject({ ...exported, source: { ...exported.source, dataUrl: 42 } })).toThrow("image data URL");
  });

  test("rejects partial envelopes and preserves legacy fingerprint serialization", () => {
    const source = createRadialSource(4);
    const legacySource = legacyFingerprintPixels(source.width, source.height, source.pixels);
    const legacyParams: PatternParams = {
      ...params(),
      contrast: 1.2345,
      backgroundColor: "#F7F6F3",
      monoColor: "#F5F5F0",
      colors: ["#F7F6F3", "#B7B6B2", "#6F6E6A", "#1D1C1A"],
    };
    const legacy = {
      app: "Pattern Lab",
      version: 1,
      fingerprint: legacyProjectFingerprint(legacyParams, legacySource),
      params: legacyParams,
      source: { name: source.name, fingerprint: legacySource, kind: "radial" },
    };
    const parsed = parseProject(legacy);
    expect(legacyProjectFingerprint(parsed.legacyParams!, legacySource)).toBe(legacy.fingerprint);
    expect(parsed.params.backgroundColor).toBe("#f7f6f3");
    expect(parsed.params.contrast).toBe(1.23);
    const { app: _app, ...partialEnvelope } = projectFor(input());
    expect(() => parseProject(partialEnvelope)).toThrow("app marker");
  });

  test("canonicalizes the project export boundary and persists source channel policy", () => {
    const model = input({ contrast: 1.2345, backgroundColor: "#ABCDEF" });
    const exported = projectFor(model);
    expect(exported.params.contrast).toBe(1.23);
    expect(exported.params.backgroundColor).toBe("#abcdef");
    expect(exported.source.usesAlpha).toBe(model.source.usesAlpha);
    const parsed = parseProject(exported);
    expect(projectFingerprint(parsed.params, model.source)).toBe(exported.fingerprint);
    const { usesAlpha: _usesAlpha, ...invalidSource } = exported.source;
    expect(() => parseProject({ ...exported, source: invalidSource })).toThrow("channel policy");
  });

  test("canonicalizes imported values to the precision shown by controls", () => {
    const parsed = parsePreset({
      contrast: 1.234,
      rowShift: 36.7,
      offsetX: -0.555,
      backgroundColor: "#ABCDEF",
      colors: ["#AAAAAA", "#BBBBBB", "#CCCCCC", "#DDDDDD"],
    });
    expect(parsed.contrast).toBe(1.23);
    expect(parsed.rowShift).toBe(37);
    expect(parsed.offsetX).toBe(-0.56);
    expect(parsed.backgroundColor).toBe("#abcdef");
    expect(parsed.colors).toEqual(["#aaaaaa", "#bbbbbb", "#cccccc", "#dddddd"]);
  });

  test("scene fingerprints are canonical and include automatic channel policy", () => {
    const source = grayscaleSource(1, 1, [0], [128]);
    const reordered = Object.fromEntries(Object.entries(params()).reverse()) as unknown as PatternParams;
    expect(projectFingerprint(params(), source)).toBe(projectFingerprint(reordered, source));
    expect(projectFingerprint(params(), source)).not.toBe(projectFingerprint(params(), { ...source, usesAlpha: !source.usesAlpha }));
  });

  test("accepts supported source image formats", () => {
    for (const name of ["x.png", "x.jpg", "x.jpeg", "x.webp", "x.avif", "x.svg"]) {
      expect(isAcceptedImage({ name, type: "" } as File)).toBe(true);
    }
    expect(isAcceptedImage({ name: "x.gif", type: "image/gif" } as File)).toBe(false);
  });
});
