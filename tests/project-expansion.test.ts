import { describe, expect, test } from "bun:test";
import { projectFor } from "../src/model/pattern";
import { DEFAULT_PARAMS, PRESETS, PARAMETER_SCHEMA, applyPreset, parsePreset, projectFingerprint } from "../src/model/params";
import { parseProject } from "../src/model/project";
import { createRadialSource, parseVectorMask } from "../src/model/source";
import type { PatternParams, SourceData } from "../src/model/types";

describe("expanded project settings", () => {
  test("starts centered, with independent neutral transforms and no distortion or motion", () => {
    expect(DEFAULT_PARAMS).toMatchObject({
      rowShift: 0, patternOffsetX: 0, patternOffsetY: 0,
      patternScaleX: 1, patternScaleY: 1, rotation: 0, jitter: 0, radialTwist: 0,
      offsetX: 0, offsetY: 0, sourceRotation: 0, animation: "none", animationPhase: 0,
    });
    for (const recipe of PRESETS) {
      expect(applyPreset({ ...DEFAULT_PARAMS, rowShift: 32, jitter: 0.5, rotation: 63, patternScaleY: 2, radialTwist: 11 }, recipe.params))
        .toMatchObject({ rowShift: 0, jitter: 0, rotation: 0, patternScaleX: 1, patternScaleY: 1, radialTwist: 0 });
    }
  });

  test("round-trips every expanded parameter and fingerprints each independently", () => {
    const source = createRadialSource(32);
    const overrides: Partial<PatternParams> = {
      preset: "radial", rowShift: 17, rowShiftMode: "wave", symmetry: "both",
      motifScale: 0.72, lineWidth: 0.62, rotation: 35, patternOffsetX: 42, patternOffsetY: -33,
      patternScaleX: 0.6, patternScaleY: 1.8, jitter: 0.3, seed: 482,
      radialCount: 18, radialBands: 6, innerRadius: 0.25, radialTwist: -12, radialTaper: 0.7,
      colorMode: "gradient", gradientType: "radial", gradientStart: "#ff6600", gradientEnd: "#5522ff",
      gradientAngle: -45, gradientCenterX: 0.1, gradientCenterY: -0.2, gradientSpan: 0.6,
      sourceMode: "ignore", sourceRotation: 34, animation: "pulse", animationDuration: 6.25,
      animationAmount: 0.4, animationPhase: 0.123,
    };
    const baseline = projectFingerprint(DEFAULT_PARAMS, source);
    for (const [key, value] of Object.entries(overrides)) {
      expect(projectFingerprint({ ...DEFAULT_PARAMS, [key]: value }, source)).not.toBe(baseline);
    }
    const params = parsePreset({ ...DEFAULT_PARAMS, ...overrides });
    const project = projectFor({ params, source });
    const parsed = parseProject(project);
    expect(parsed.version).toBe(3);
    expect(parsed.params).toEqual(params);
    expect(projectFingerprint(parsed.params, source)).toBe(project.fingerprint);
  });

  test("rejects invalid controls instead of accepting NaN or unsafe input", () => {
    for (const value of [
      { patternScaleX: 0 }, { patternScaleY: 4.01 }, { patternOffsetX: 4097 },
      { rotation: Infinity }, { seed: -1 }, { radialCount: 129 }, { animation: "noise" },
      { animationDuration: 0 }, { animationPhase: 1.1 }, { gradientStart: "url(https://example.com)" },
      { gradientType: "conic" }, { sourceMode: "external" }, { gridAlignment: "random" },
    ]) expect(() => parsePreset(value)).toThrow();
    expect(parsePreset({ animationPhase: 0.1234 }).animationPhase).toBe(0.123);
    expect(parsePreset({ patternOffsetX: 1.6 }).patternOffsetX).toBe(2);
  });

  test("retains and fingerprints vector source geometry independently from raster pixels", () => {
    const { kind: _kind, ...source } = createRadialSource(32);
    const vectorSource: SourceData = {
      ...source, dataUrl: "data:image/png;base64,fixture",
      vectorMask: { viewBox: [0, 0, 32, 32], paths: [{ d: "M0 0H32V32H0Z", transform: [1, 0, 0, 1, 0, 0], fillRule: "nonzero" }] },
    };
    const project = projectFor({ params: DEFAULT_PARAMS, source: vectorSource });
    const parsed = parseProject(project);
    expect(parsed.source?.vectorMask).toEqual(parseVectorMask(vectorSource.vectorMask));
    expect(projectFingerprint(parsed.params, { ...source, ...parsed.source } as SourceData)).toBe(project.fingerprint);
    expect(projectFingerprint(DEFAULT_PARAMS, source)).not.toBe(project.fingerprint);
    const changed: SourceData = { ...vectorSource, vectorMask: { ...vectorSource.vectorMask!, paths: [{ ...vectorSource.vectorMask!.paths[0]!, d: "M0 0H16V32H0Z" }] } };
    expect(projectFingerprint(DEFAULT_PARAMS, changed)).not.toBe(project.fingerprint);
    expect(() => parseProject({ ...project, source: { ...project.source, vectorMask: { viewBox: [0, 0, 32, 32], paths: [{ d: '<script>alert(1)</script>', transform: [1, 0, 0, 1, 0, 0], fillRule: "nonzero" }] } } })).toThrow();
  });
});

test("describes every parameter for programs and rejects unknown edits", () => {
  expect(Object.keys(PARAMETER_SCHEMA.properties)).toEqual(Object.keys(DEFAULT_PARAMS));
  expect(PARAMETER_SCHEMA.properties.patternScaleX).toMatchObject({ type: "number", minimum: 0.1, maximum: 4, default: 1 });
  expect(PARAMETER_SCHEMA.properties.patternOffsetX).toMatchObject({ type: "integer", minimum: -4096, maximum: 4096, default: 0 });
  expect(PARAMETER_SCHEMA.properties.colorCount).toMatchObject({ type: "integer", enum: [2, 3, 4], default: 2 });
  expect(PARAMETER_SCHEMA.properties.animation).toMatchObject({ type: "string", enum: ["none", "pulse", "rotate", "wave"] });
  expect(() => parsePreset({ colourMode: "gradient" })).toThrow("Unknown pattern parameter");
  expect(() => parsePreset({ ...DEFAULT_PARAMS, gridAlignment: "edge" })).toThrow("Unknown pattern parameter");
  expect(() => parseProject({ ...projectFor({ params: DEFAULT_PARAMS, source: createRadialSource(32) }), version: 2 })).toThrow("version is not supported");
});

test("serializes masks, layout, and sparse individual cell overrides canonically", () => {
  const params = parsePreset({
    maskShape: "triangle", maskSides: 7, maskScale: 0.8, maskRotation: 30,
    layoutColumns: 3, layoutRows: 2, layoutGapX: 24, layoutGapY: 48,
    paddingTop: 20, paddingRight: 30, paddingBottom: 40, paddingLeft: 50,
    layoutCells: [{ index: 5, offsetX: -12, rotation: 15, maskRotation: 24 }, { index: 0, scaleX: 0.75, scaleY: 1.2, padding: 12, maskShape: "octagon" }],
  });
  expect(params.layoutCells.map((cell) => cell.index)).toEqual([0, 5]);
  const source = createRadialSource(32);
  const scene = projectFor({ params, source });
  expect(parseProject(scene).params).toEqual(params);
  expect(projectFingerprint(parsePreset({ ...params, layoutCells: [...params.layoutCells].reverse() }), source)).toBe(scene.fingerprint);
  const altered = applyPreset(params, { layoutCells: [{ index: 0, offsetY: 22 }] });
  altered.layoutCells[0]!.offsetY = 33;
  expect(params.layoutCells[0]!.offsetY).toBeUndefined();
  expect(projectFingerprint(altered, source)).not.toBe(scene.fingerprint);
  expect(PARAMETER_SCHEMA.properties.layoutCells).toMatchObject({ type: "array", maxItems: 144 });
  for (const layoutCells of [[{ index: 0 }, { index: 0 }], [{ index: 144 }], [{ index: 0.5 }], [{ index: 0, rotate: 12 }], [{ index: 0, scaleY: 0 }], [{ index: 0, maskShape: "external" }]]) {
    expect(() => parsePreset({ layoutCells })).toThrow();
  }
});


test("round-trips complete-cell controls and distinguishes shape gaps from pattern-repeat gaps", () => {
  const values = {
    useCells: true, cellShape: "triangle", cellSides: 7,
    cellGapX: 13, cellGapY: 19, cellPadding: 2.5, cellRotation: 35, cellThreshold: 0.65,
    layoutGapX: 41, layoutGapY: 53,
  };
  const parsed = parsePreset(values);
  for (const [key, value] of Object.entries(values)) expect(parsed[key as keyof typeof parsed]).toEqual(value);
  expect(parsePreset(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  for (const value of [{ useCells: 1 }, { cellShape: "star" }, { cellSides: 33 }, { cellGapX: -1 },
    { cellPadding: 129 }, { cellRotation: 181 }, { cellThreshold: 1.01 }]) expect(() => parsePreset(value)).toThrow();
  expect(PARAMETER_SCHEMA.properties.cellGapX).toMatchObject({ type: "integer", minimum: 0, maximum: 1024 });
  expect(PARAMETER_SCHEMA.properties.useCells).toMatchObject({ type: "boolean" });
});
