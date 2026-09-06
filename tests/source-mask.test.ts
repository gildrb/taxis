import { describe, expect, spyOn, test } from "bun:test";
import { DEFAULT_PARAMS } from "../src/model/params";
import { createRadialSource, dataUrlToSource, fileToSource, fingerprintPixels, geometricMask, geometricMaskContains, maskForSource, pixelsToSource, sampleSource, sourceCoverage, sourcePlacement } from "../src/model/source";
import { createSvgRenderer, type SvgRenderer } from "../src/render/native";
import { decodeSourcePng } from "../src/model/png-source";
import { deflateSync } from "node:zlib";
import { multiplyMatrices, normalizeSvgPath, parseSvgTransform, parseVectorMask, svgShapePath } from "../src/model/svg-mask";
import type { Matrix, PatternParams, SourceData, VectorMask } from "../src/model/types";

function params(overrides: Partial<PatternParams> = {}): PatternParams {
  return { ...DEFAULT_PARAMS, width: 100, height: 100, symmetry: "none", sourceRotation: 0, ...overrides };
}

function grayscale(width: number, height: number, values: number[]): SourceData {
  const pixels = new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]));
  return { width, height, pixels, usesAlpha: false, name: "Fixture", fingerprint: fingerprintPixels(width, height, pixels) };
}

function point(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

const fixtureMask: VectorMask = { viewBox: [10, 20, 40, 20], paths: [{ d: "M10 20h40v20H10z", transform: [1, 0, 0, 1, 0, 0], fillRule: "evenodd" }] };

describe("safe vector mask schema", () => {
  test("normalizes only path data, matrices, viewBox and independent fill rules", () => {
    const mask = parseVectorMask(fixtureMask);
    expect(mask).toEqual({ viewBox: [10, 20, 40, 20], paths: [{ d: "M 10 20 L 50 20 L 50 40 L 10 40 Z", transform: [1, 0, 0, 1, 0, 0], fillRule: "evenodd" }] });
    expect(parseVectorMask(mask)).toEqual(mask);
    expect(mask).not.toBe(fixtureMask);
    expect(mask.paths[0]).not.toBe(fixtureMask.paths[0]);
  });

  test("rejects markup, links, unsupported fields and invalid geometry", () => {
    for (const value of [null, [], {}, { ...fixtureMask, xml: "<script />" }, { ...fixtureMask, viewBox: [0, 0, 0, 1] }, { ...fixtureMask, viewBox: [0, 0, 1, Infinity] }, { ...fixtureMask, paths: [] }]) {
      expect(() => parseVectorMask(value)).toThrow();
    }
    for (const path of [
      { ...fixtureMask.paths[0], d: '<path d="M0 0" onload="fetch(1)"/>' },
      { ...fixtureMask.paths[0], d: "url(https://example.com)" },
      { ...fixtureMask.paths[0], d: "M0 0 N 1 2" },
      { ...fixtureMask.paths[0], d: "M0 0 L1e309 0" },
      { ...fixtureMask.paths[0], transform: [1, 0, 0, 1, 0, NaN] },
      { ...fixtureMask.paths[0], transform: [1, 0, 0, 1, 0, 0, 1] },
      { ...fixtureMask.paths[0], fillRule: "inherit" },
      { ...fixtureMask.paths[0], href: "https://example.com" },
    ]) expect(() => parseVectorMask({ ...fixtureMask, paths: [path] })).toThrow();
  });

  test("bounds path size, path counts, coordinate magnitudes and normalized output", () => {
    expect(() => parseVectorMask({ ...fixtureMask, paths: Array(4097).fill(fixtureMask.paths[0]) })).toThrow("4096");
    expect(() => parseVectorMask({ ...fixtureMask, paths: [{ ...fixtureMask.paths[0], d: "M0 0" + " ".repeat(200_000) }] })).toThrow("200,000");
    expect(() => parseVectorMask({ ...fixtureMask, viewBox: [1e10, 0, 1, 1] })).toThrow("1e9");
    expect(() => parseVectorMask({ ...fixtureMask, paths: Array(10).fill({ ...fixtureMask.paths[0], d: "M0 0" + " ".repeat(100_000) }) })).toThrow("1,000,000");
    expect(() => normalizeSvgPath("M0 0" + "l999 999 ".repeat(15_000))).toThrow("200,000");
  });
});

describe("SVG path and primitive normalization", () => {
  test("expands relative, implicit, horizontal and vertical commands", () => {
    expect(normalizeSvgPath("m1,2 3 4 h5 v-2 z m1 1 l.5-.5"))
      .toBe("M 1 2 L 4 6 L 9 6 L 9 4 Z M 2 3 L 2.5 2.5");
    expect(normalizeSvgPath("M1e1 -0 L.5.6")).toBe("M 10 0 L 0.5 0.6");
  });

  test("preserves cubic, quadratic, reflected controls and arc flag grammar", () => {
    expect(normalizeSvgPath("M0 0c1 2 3 4 5 6s2 3 4 5q1 2 3 4t5 6"))
      .toBe("M 0 0 C 1 2 3 4 5 6 C 7 8 7 9 9 11 Q 10 13 12 15 Q 14 17 17 21");
    expect(normalizeSvgPath("M0 0 A5 5 0 0110 10 a5 4 30 1 0-5-6"))
      .toBe("M 0 0 A 5 5 0 0 1 10 10 A 5 4 30 1 0 5 4");
    for (const d of ["", "L0 0", "M0", "M,0 0", "M0,,0", "M0 0,", "M0 0z1 2", "M0 0A-1 2 0 0 1 3 4", "M0 0A1 2 0 2 1 3 4", "M0 0Q1 2 3"]) {
      expect(() => normalizeSvgPath(d)).toThrow();
    }
  });

  test("converts rectangle, rounded rectangle, circle, ellipse and filled polygons", () => {
    expect(svgShapePath("rect", { x: "1", y: "2", width: "3", height: "4" })).toBe("M 1 2 L 4 2 L 4 6 L 1 6 Z");
    expect(svgShapePath("rect", { width: "10", height: "6", rx: "99" })).toContain("A 5 3 0 0 1");
    expect(svgShapePath("circle", { cx: "10", cy: "20", r: "5" })).toBe("M 5 20 A 5 5 0 1 0 15 20 A 5 5 0 1 0 5 20 Z");
    expect(svgShapePath("ellipse", { cx: "10", cy: "20", rx: "5", ry: "3" })).toContain("A 5 3 0 1 0");
    expect(svgShapePath("polygon", { points: "0,0 10,0 5,10" })).toBe("M 0 0 L 10 0 L 5 10 Z");
    expect(svgShapePath("polyline", { points: "0,0 10,0 5,10" })).toBe("M 0 0 L 10 0 L 5 10 Z");
    expect(svgShapePath("rect", { width: "1in", height: "1px" })).toContain("L 96 1");
    expect(svgShapePath("circle", { r: "0" })).toBe("");
    expect(svgShapePath("path", { d: "" })).toBe("");
    for (const [tag, attributes] of [["line", {}], ["rect", { width: "-1", height: "4" }], ["circle", { r: "10%" }], ["polygon", { points: "1 2 3" }]] as const) {
      expect(() => svgShapePath(tag, attributes)).toThrow();
    }
  });
});

describe("SVG affine transforms", () => {
  test("composes transform lists and nested groups in SVG order", () => {
    expect(parseSvgTransform("translate(10 20) scale(2 3)")).toEqual([2, 0, 0, 3, 10, 20]);
    const nested = multiplyMatrices(parseSvgTransform("translate(10,20)"), parseSvgTransform("scale(2) translate(3 4)"));
    expect(point(nested, 1, 2)).toEqual([18, 32]);
    expect(parseSvgTransform("matrix(1 2 3 4 5 6)")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseSvgTransform("")).toEqual([1, 0, 0, 1, 0, 0]);
  });

  test("supports rotation centers, skew and reflection", () => {
    const rotated = point(parseSvgTransform("rotate(90 10 20)"), 11, 20);
    expect(rotated[0]).toBeCloseTo(10, 12);
    expect(rotated[1]).toBeCloseTo(21, 12);
    expect(point(parseSvgTransform("skewX(45)"), 2, 3)[0]).toBeCloseTo(5, 12);
    expect(point(parseSvgTransform("skewY(45)"), 2, 3)[1]).toBeCloseTo(5, 12);
    expect(point(parseSvgTransform("scale(-1 1)"), 2, 3)).toEqual([-2, 3]);
  });

  test("rejects CSS, malformed arity, trailing text and nonfinite transforms", () => {
    for (const value of ["translateX(1px)", "rotate(1 2)", "matrix(1 0 0 1)", "translate(1),", "scale(1 2 3)", "skewX(90)", "scale(1e309)", "scale(2) trailing", "translate(1,,2)"]) {
      expect(() => parseSvgTransform(value)).toThrow();
    }
  });
});

describe("source placement and analytic masks", () => {
  const source = grayscale(4, 2, [0, 40, 80, 120, 140, 180, 220, 255]);

  test("preserves contain, cover, stretch, offsets and source-centered rotation", () => {
    expect(sourcePlacement(params({ fit: "contain" }), source)).toEqual([25, 0, 0, 25, 0, 25]);
    expect(sourcePlacement(params({ fit: "cover" }), source)).toEqual([50, 0, 0, 50, -50, 0]);
    expect(sourcePlacement(params({ fit: "stretch", scale: 0.5, offsetX: 0.2, offsetY: -0.4 }), source)).toEqual([12.5, 0, 0, 25, 35, 5]);
    const rotated = sourcePlacement(params({ fit: "contain", sourceRotation: 90, offsetX: 0.2 }), source);
    expect(point(rotated, 2, 1)[0]).toBeCloseTo(60, 12);
    expect(point(rotated, 2, 1)[1]).toBeCloseTo(50, 12);
    expect(point(rotated, 0, 0)[0]).toBeCloseTo(85, 12);
    expect(point(rotated, 0, 0)[1]).toBeCloseTo(0, 12);
  });

  test("maps a nonzero original viewBox and independent path transforms into output", () => {
    const vectorSource = { ...source, vectorMask: parseVectorMask(fixtureMask) };
    const mask = maskForSource(vectorSource, params({ fit: "contain" }));
    expect(mask.viewBox).toEqual([0, 0, 100, 100]);
    expect(point(mask.paths[0]!.transform, 10, 20)).toEqual([0, 25]);
    expect(point(mask.paths[0]!.transform, 50, 40)).toEqual([100, 75]);
    expect(mask.paths[0]!.fillRule).toBe("evenodd");
    expect(vectorSource.vectorMask).toEqual(parseVectorMask(fixtureMask));
  });

  test("generated masks use exact analytic circle radius instead of tracing quantized pixels", () => {
    const generated = createRadialSource(100);
    const fingerprint = generated.fingerprint;
    const mask = maskForSource(generated, params({ fit: "stretch" }));
    expect(mask.paths).toHaveLength(1);
    expect(mask.paths[0]!.d).toBe("M 13.5 50 A 36.5 36.5 0 1 0 86.5 50 A 36.5 36.5 0 1 0 13.5 50 Z");
    expect(mask.paths[0]!.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(generated.fingerprint).toBe(fingerprint);
    expect(fingerprintPixels(generated.width, generated.height, generated.pixels)).toBe(fingerprint);
  });

  test("rejects unsupported raster masks and explicit mask symmetry without corrupting geometry", () => {
    expect(() => maskForSource(source, params())).toThrow("Use Sample mode");
    for (const symmetry of ["x", "y", "both"] as const) {
      expect(() => maskForSource(createRadialSource(4), params({ symmetry }))).toThrow("Set symmetry to None");
    }
    const tinyBox = { ...source, vectorMask: { ...fixtureMask, viewBox: [0, 0, 1e-309, 1] as VectorMask["viewBox"] } };
    expect(() => maskForSource(tinyBox, params())).toThrow("supported output range");
  });
});

describe("symmetric pixel-center source sampling", () => {
  test("bilinearly interpolates pixel centers in both axes and clamps symmetrically at source edges", () => {
    const source = grayscale(2, 2, [0, 100, 200, 255]);
    const settings = params({ width: 2, height: 2, fit: "stretch" });
    expect(sampleSource(source, 0.5, 0.5, settings).red).toBe(0);
    expect(sampleSource(source, 1, 1, settings).red).toBe(138.75 / 255);
    expect(sampleSource(source, 0, 1, settings).red).toBe(100 / 255);
    expect(sampleSource(source, 2, 1, settings).red).toBe(177.5 / 255);
    expect(sampleSource(source, -0.001, 1, settings).alpha).toBe(0);
    expect(sampleSource(source, 2.001, 1, settings).alpha).toBe(0);
  });

  test("samples generated circles symmetrically at integer-boundary ties for odd/even sizes and fits", () => {
    for (const size of [16, 17, 32, 33]) {
      const source = createRadialSource(size);
      for (const fit of ["contain", "cover", "stretch"] as const) {
        const settings = params({ fit, width: 100, height: 80 });
        for (let x = 0; x <= 100; x += 2) {
          for (let y = 0; y <= 80; y += 2) {
            const value = sampleSource(source, x, y, settings).value;
            expect(sampleSource(source, 100 - x, y, settings).value).toBeCloseTo(value, 12);
            expect(sampleSource(source, x, 80 - y, settings).value).toBeCloseTo(value, 12);
          }
        }
      }
    }
  });

  test("keeps exact quarter-turn footprint boundaries symmetric", () => {
    const source = createRadialSource(32);
    for (const sourceRotation of [0, 90, 180, 270, -90, 360]) {
      const settings = params({ sourceRotation, fit: "stretch" });
      for (const x of [0, 50, 100]) {
        for (const y of [0, 50, 100]) expect(sampleSource(source, x, y, settings).alpha).toBe(1);
      }
    }
  });

  test("mirrors arbitrary source samples intentionally before source rotation and offsets", () => {
    const source = grayscale(4, 2, [0, 40, 80, 120, 140, 180, 220, 255]);
    for (const symmetry of ["x", "y", "both"] as const) {
      const settings = params({ fit: "cover", symmetry, sourceRotation: 31, offsetX: 0.12, offsetY: -0.08 });
      const sample = sampleSource(source, 20, 30, settings);
      if (symmetry !== "y") expect(sampleSource(source, 80, 30, settings)).toEqual(sample);
      if (symmetry !== "x") expect(sampleSource(source, 20, 70, settings)).toEqual(sample);
      if (symmetry === "both") expect(sampleSource(source, 80, 70, settings)).toEqual(sample);
    }
    expect(sampleSource(source, 20, 30, params({ fit: "stretch" })).red)
      .not.toBe(sampleSource(source, 80, 30, params({ fit: "stretch" })).red);
  });

  test("inverse sampling matches sourcePlacement with rotation, scale and offsets", () => {
    const source = grayscale(4, 2, [0, 40, 80, 120, 140, 180, 220, 255]);
    const settings = params({ fit: "contain", sourceRotation: 73, offsetX: -0.2, offsetY: 0.4, scale: 1.3 });
    const placement = sourcePlacement(settings, source);
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const [outputX, outputY] = point(placement, x + 0.5, y + 0.5);
        expect(sampleSource(source, outputX, outputY, settings).red).toBeCloseTo(source.pixels[(y * source.width + x) * 4]! / 255, 12);
      }
    }
  });

  test("interpolates source color and alpha independently of the selected signal channel", () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255]);
    const source: SourceData = { width: 2, height: 1, pixels, usesAlpha: true, name: "Color fixture", fingerprint: fingerprintPixels(2, 1, pixels) };
    const settings = params({ width: 2, height: 1, fit: "stretch", sampleChannel: "auto" });
    const sample = sampleSource(source, 1, 0.5, settings);
    expect(sample).toEqual({ red: 0.5, green: 0, blue: 0.5, alpha: 0.5, value: 0.5 });
    expect(sampleSource(source, 1, 0.5, { ...settings, sampleChannel: "luminance" }).value).toBeCloseTo(0.1424, 12);
    expect(sampleSource(source, 0, 0.5, settings).red).toBe(1);
    expect(sampleSource(source, 2, 0.5, settings).blue).toBe(1);
  });
});


describe("built-in geometric masks", () => {
  function vertices(mask: VectorMask, transformed = false): [number, number][] {
    const path = mask.paths[0]!;
    return [...path.d.matchAll(/[ML] ([^ ]+) ([^ ]+)/g)].map((match) => {
      const x = Number(match[1]);
      const y = Number(match[2]);
      return transformed ? point(path.transform, x, y) : [x, y];
    });
  }

  test("none leaves the scene unmasked and circles use exact editable arcs", () => {
    expect(geometricMask(params())).toBeUndefined();
    const mask = geometricMask(params({ maskShape: "circle", width: 200, height: 100, maskScale: 0.8 }))!;
    expect(mask).toEqual({
      viewBox: [0, 0, 200, 100],
      paths: [{ d: "M 60 50 A 40 40 0 1 0 140 50 A 40 40 0 1 0 60 50 Z", transform: [1, 0, 0, 1, 0, 0], fillRule: "nonzero" }],
    });
    expect(parseVectorMask(mask)).toEqual(mask);
  });

  test("fits upright equilateral triangles and centers bounds rather than the centroid", () => {
    const mask = geometricMask(params({ maskShape: "triangle", width: 200, height: 100 }))!;
    const points = vertices(mask);
    expect(points).toHaveLength(3);
    expect(points[0]![0]).toBeCloseTo(100, 12);
    expect(points[0]![1]).toBeCloseTo(0, 12);
    expect(points[1]![1]).toBeCloseTo(100, 12);
    expect(points[2]![1]).toBeCloseTo(100, 12);
    const [left, right] = [Math.min(...points.map(([x]) => x)), Math.max(...points.map(([x]) => x))];
    expect((left + right) / 2).toBeCloseTo(100, 12);
    expect(right - left).toBeCloseTo(200 / Math.sqrt(3), 12);
    expect(points.reduce((total, [, y]) => total + y, 0) / 3).toBeCloseTo(200 / 3, 12);
    expect(geometricMask(params({ maskShape: "polygon", maskSides: 3, width: 200, height: 100 }))).toEqual(mask);
  });

  test("square sides stay flat and regular octagons have a flat top", () => {
    const square = geometricMask(params({ maskShape: "square", width: 200, height: 100 }))!;
    expect(vertices(square)).toEqual([[50, 0], [150, 0], [150, 100], [50, 100]]);
    expect(geometricMask(params({ maskShape: "polygon", maskSides: 4, width: 200, height: 100 }))).toEqual(square);
    const octagon = geometricMask(params({ maskShape: "octagon", width: 200, height: 100 }))!;
    const points = vertices(octagon);
    const top = Math.min(...points.map(([, y]) => y));
    expect(points).toHaveLength(8);
    expect(points.filter(([, y]) => Math.abs(y - top) < 1e-10)).toHaveLength(2);
    expect(geometricMask(params({ maskShape: "polygon", maskSides: 8, width: 200, height: 100 }))).toEqual(octagon);
  });

  test("all polygon counts preserve equal edges and centered maximum-fit bounds at fractional cell sizes", () => {
    for (const [width, height] of [[200, 100], [71.25, 113.5], [1 / 3, 2 / 7]]) {
      for (let maskSides = 3; maskSides <= 32; maskSides++) {
        for (const maskScale of [0.1, 0.65, 1]) {
          const mask = geometricMask(params({ maskShape: "polygon", maskSides, maskScale, width, height }))!;
          const points = vertices(mask);
          const left = Math.min(...points.map(([x]) => x));
          const right = Math.max(...points.map(([x]) => x));
          const top = Math.min(...points.map(([, y]) => y));
          const bottom = Math.max(...points.map(([, y]) => y));
          expect(points).toHaveLength(maskSides);
          expect(mask.viewBox).toEqual([0, 0, width!, height!]);
          expect((left + right) / 2).toBeCloseTo(width! / 2, 11);
          expect((top + bottom) / 2).toBeCloseTo(height! / 2, 11);
          expect(left).toBeGreaterThanOrEqual(-1e-10);
          expect(top).toBeGreaterThanOrEqual(-1e-10);
          expect(right).toBeLessThanOrEqual(width! + 1e-10);
          expect(bottom).toBeLessThanOrEqual(height! + 1e-10);
          expect(Math.max((right - left) / width!, (bottom - top) / height!)).toBeCloseTo(maskScale, 11);
          const length = Math.hypot(points[1]![0] - points[0]![0], points[1]![1] - points[0]![1]);
          for (let index = 0; index < points.length; index++) {
            const next = points[(index + 1) % points.length]!;
            expect(Math.hypot(next[0] - points[index]![0], next[1] - points[index]![1])).toBeCloseTo(length, 10);
          }
          expect(parseVectorMask(mask)).toEqual(mask);
        }
      }
    }
  });

  test("rotates about the local output center after bounds centering without refitting", () => {
    const settings = params({ maskShape: "triangle", maskRotation: 90, width: 200, height: 100 });
    const mask = geometricMask(settings)!;
    const rotated = vertices(mask, true);
    const unrotated = vertices(geometricMask({ ...settings, maskRotation: 0 })!);
    expect(point(mask.paths[0]!.transform, 100, 50)[0]).toBeCloseTo(100, 12);
    expect(point(mask.paths[0]!.transform, 100, 50)[1]).toBeCloseTo(50, 12);
    for (let index = 0; index < rotated.length; index++) {
      expect(rotated[index]![0]).toBeCloseTo(150 - unrotated[index]![1], 12);
      expect(rotated[index]![1]).toBeCloseTo(unrotated[index]![0] - 50, 12);
    }
    expect(rotated[0]![0]).toBeCloseTo(150, 12);
    expect(rotated[0]![1]).toBeCloseTo(50, 12);
    expect(Math.min(...rotated.map(([, y]) => y))).toBeLessThan(0);
    expect(Math.max(...rotated.map(([, y]) => y))).toBeGreaterThan(100);
    expect(geometricMask({ ...settings, sourceRotation: -70, scale: 2, offsetX: 0.2, symmetry: "both", rotation: 45, patternScaleX: 3, patternOffsetX: 10 })).toEqual(mask);
  });

  test("bounds invalid polygons and dimensions before allocating geometry", () => {
    for (const maskSides of [2, 33, 3.5, NaN, Infinity]) {
      expect(() => geometricMask(params({ maskShape: "polygon", maskSides }))).toThrow("3 to 32");
    }
    for (const maskScale of [0, 0.09, 1.01, Infinity, NaN]) {
      expect(() => geometricMask(params({ maskShape: "circle", maskScale }))).toThrow("Mask scale");
    }
    for (const maskRotation of [-181, 181, Infinity, NaN]) {
      expect(() => geometricMask(params({ maskShape: "square", maskRotation }))).toThrow("Mask rotation");
    }
    for (const dimensions of [{ width: 0 }, { height: -1 }, { width: Infinity }, { height: NaN }]) {
      expect(() => geometricMask(params({ maskShape: "triangle", ...dimensions }))).toThrow("canvas dimensions");
    }
    expect(() => geometricMask(params({ maskShape: "star" as PatternParams["maskShape"] }))).toThrow("supported shape");
  });
});


describe("pure whole-cell center inclusion", () => {
  test("generated source coverage is an exact disk, not opaque source alpha or quantized luminance", () => {
    for (const size of [1, 4, 17, 100]) {
      const source = createRadialSource(size);
      const settings = params({ width: 100, height: 100, fit: "stretch" });
      expect(sourceCoverage(source, 50, 50, settings)).toBe(1);
      expect(sourceCoverage(source, 13.5, 50, settings)).toBe(1);
      expect(sourceCoverage(source, 86.5, 50, settings)).toBe(1);
      expect(sourceCoverage(source, 13.49999, 50, settings)).toBe(0);
      expect(sourceCoverage(source, 86.50001, 50, settings)).toBe(0);
      expect(sourceCoverage(source, 0, 0, settings)).toBe(0);
      expect(sampleSource(source, 0, 0, settings).alpha).toBe(1);
      source.pixels.fill(0);
      expect(sourceCoverage(source, 50, 50, settings)).toBe(1);
      expect(sourceCoverage(source, NaN, 50, settings)).toBe(0);
    }
  });

  test("radial coverage follows the same source fit, scale, offset and rotation matrix", () => {
    const source = createRadialSource(20);
    for (const fit of ["contain", "cover", "stretch"] as const) {
      for (const sourceRotation of [-180, -37, 0, 90, 141]) {
        const settings = params({ width: 180, height: 100, fit, sourceRotation, scale: 0.7, offsetX: 0.2, offsetY: -0.3 });
        const placement = sourcePlacement(settings, source);
        for (const [x, y, expected] of [[10, 10, 1], [17.3, 10, 1], [17.301, 10, 0], [10, 2.7, 1], [10, 2.699, 0], [0, 0, 0]]) {
          const [outputX, outputY] = point(placement, x!, y!);
          expect(sourceCoverage(source, outputX, outputY, settings)).toBe(expected!);
        }
      }
    }
  });

  test("imported coverage uses only raw bilinear alpha, regardless of vector metadata or signal adjustments", () => {
    const source = grayscale(2, 1, [255, 0]);
    source.pixels[3] = 0;
    source.pixels[7] = 128;
    source.vectorMask = fixtureMask;
    source.usesAlpha = false;
    for (const sampleChannel of ["auto", "alpha", "luminance"] as const) {
      const settings = params({ width: 2, height: 1, fit: "stretch", sampleChannel, invert: true, contrast: 4, luminanceBias: 1 });
      expect(sourceCoverage(source, 0.5, 0.5, settings)).toBe(0);
      expect(sourceCoverage(source, 1, 0.5, settings)).toBe(64 / 255);
      expect(sourceCoverage(source, 1.5, 0.5, settings)).toBe(128 / 255);
      expect(sourceCoverage(source, 3, 0.5, settings)).toBe(0);
      expect(sourceCoverage(source, Infinity, 0.5, settings)).toBe(0);
    }
    const opaque = grayscale(2, 1, [0, 255]);
    expect(sourceCoverage(opaque, 0.5, 0.5, params({ width: 2, height: 1, fit: "stretch" }))).toBe(1);
  });

  test("source coverage intentionally mirrors centers before inverse placement", () => {
    const source = createRadialSource(17);
    for (const symmetry of ["x", "y", "both"] as const) {
      const settings = params({ symmetry, sourceRotation: 31, scale: 0.75, offsetX: -0.3, offsetY: -0.1 });
      for (let x = 0; x <= 50; x += 5) {
        for (let y = 0; y <= 50; y += 5) {
          const coverage = sourceCoverage(source, x, y, settings);
          if (symmetry !== "y") expect(sourceCoverage(source, 100 - x, y, settings)).toBe(coverage);
          if (symmetry !== "x") expect(sourceCoverage(source, x, 100 - y, settings)).toBe(coverage);
          if (symmetry === "both") expect(sourceCoverage(source, 100 - x, 100 - y, settings)).toBe(coverage);
        }
      }
    }
  });

  test("built-in circle inclusion is analytic and no clip admits every center", () => {
    expect(geometricMaskContains(params(), -1000, 5000)).toBe(true);
    const settings = params({ maskShape: "circle", maskScale: 0.8, maskRotation: 37, width: 200, height: 100 });
    expect(geometricMaskContains(settings, 100, 50)).toBe(true);
    expect(geometricMaskContains(settings, 60, 50)).toBe(true);
    expect(geometricMaskContains(settings, 140, 50)).toBe(true);
    expect(geometricMaskContains(settings, 140.00001, 50)).toBe(false);
    expect(geometricMaskContains(settings, 100, 9.99999)).toBe(false);
    expect(geometricMaskContains(settings, 130, 80)).toBe(false);
    expect(geometricMaskContains(settings, NaN, 50)).toBe(false);
  });

  test("polygon center predicates share exact rotated vector edges for every side count", () => {
    for (let maskSides = 3; maskSides <= 32; maskSides++) {
      for (const maskRotation of [-180, -37, 0, 90, 141]) {
        const settings = params({ maskShape: "polygon", maskSides, maskRotation, maskScale: 0.7, width: 123.25, height: 87.5 });
        const path = geometricMask(settings)!.paths[0]!;
        const vertices = [...path.d.matchAll(/[ML] ([^ ]+) ([^ ]+)/g)].map((match) => point(path.transform, Number(match[1]), Number(match[2])));
        const centerX = vertices.reduce((sum, [x]) => sum + x, 0) / vertices.length;
        const centerY = vertices.reduce((sum, [, y]) => sum + y, 0) / vertices.length;
        expect(geometricMaskContains(settings, centerX, centerY)).toBe(true);
        for (let index = 0; index < vertices.length; index++) {
          const [x, y] = vertices[index]!;
          const [nextX, nextY] = vertices[(index + 1) % vertices.length]!;
          expect(geometricMaskContains(settings, x, y)).toBe(true);
          expect(geometricMaskContains(settings, (x + nextX) / 2, (y + nextY) / 2)).toBe(true);
          expect(geometricMaskContains(settings, centerX + (x - centerX) * 0.9, centerY + (y - centerY) * 0.9)).toBe(true);
          expect(geometricMaskContains(settings, centerX + (x - centerX) * 1.001, centerY + (y - centerY) * 1.001)).toBe(false);
        }
      }
    }
  });
});


describe("native SVG source loading", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="2" height="4" fill="#2468ac" opacity="0.1"/><rect x="2" width="2" height="4" fill="#913457" opacity="0.5"/><rect x="4" width="2" height="4" fill="#7fb326" opacity="0.9"/></svg>';

  test("shares exact raw-pixel fingerprint and alpha analysis without premultiplication", () => {
    const pixels = new Uint8ClampedArray([17, 33, 201, 1, 19, 78, 202, 127, 121, 101, 9, 255, 0, 0, 0, 0]);
    const source = pixelsToSource(4, 1, pixels, "Raw fixture", "data:image/png;base64,owned");
    expect(source.pixels).toEqual(pixels);
    expect(source.usesAlpha).toBe(true);
    expect(source.fingerprint).toBe(fingerprintPixels(4, 1, pixels));
    expect(source.dataUrl).toBe("data:image/png;base64,owned");
    expect(pixelsToSource(1, 1, new Uint8ClampedArray([19, 78, 202, 127]), "Uniform opacity").usesAlpha).toBe(false);
    expect(() => pixelsToSource(2, 1, new Uint8ClampedArray(4), "Bad dimensions")).toThrow("RGBA dimensions");
  });

  test("loads SVG pixels and embedded PNG through the retained native document", async () => {
    const renderer = await createSvgRenderer(await Bun.file(new URL("../public/renderer/kor.wasm", import.meta.url)).arrayBuffer());
    const expected = renderer.createDocument(svg);
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const source = await fileToSource(new File([svg], "Native.svg", { type: "image/svg+xml" }), renderer, 4);
      expect({ width: source.width, height: source.height }).toEqual({ width: 4, height: 2 });
      expect(source.pixels).toEqual(expected.render(4, 2).pixels);
      expect(source.usesAlpha).toBe(true);
      expect(source.fingerprint).toBe(fingerprintPixels(4, 2, source.pixels));
      expect(source.dataUrl).toBe(`data:image/png;base64,${Buffer.from(expected.png(4, 2)).toString("base64")}`);
      expect(source.vectorMask).toBeUndefined();
      expect(() => maskForSource(source, params())).toThrow("browser XML parser");
      const embeddedSvg = await dataUrlToSource(`data:image/svg+xml,${encodeURIComponent(svg)}`, "Embedded.svg", renderer);
      expect(embeddedSvg.pixels).toEqual(expected.render(8, 4).pixels);
    } finally {
      expected.dispose();
      warning.mockRestore();
    }
  });

  test("restores native low-alpha PNG bytes exactly without any browser codec", async () => {
    const renderer = await createSvgRenderer(await Bun.file(new URL("../public/renderer/kor.wasm", import.meta.url)).arrayBuffer());
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const source = await fileToSource(new File([svg], "Native.svg", { type: "image/svg+xml" }), renderer);
      const restored = await dataUrlToSource(source.dataUrl!, source.name, renderer);
      expect(restored.width).toBe(source.width);
      expect(restored.height).toBe(source.height);
      expect(restored.pixels).toEqual(source.pixels);
      expect(restored.fingerprint).toBe(source.fingerprint);
      expect(restored.usesAlpha).toBe(source.usesAlpha);
      expect(restored.dataUrl).toBe(source.dataUrl);
      expect(restored.vectorMask).toBeUndefined();
    } finally {
      warning.mockRestore();
    }
  });

  test("disposes failed native documents and never falls back to a browser SVG decoder", async () => {
    let disposed = 0;
    const renderer: SvgRenderer = {
      createDocument() {
        return {
          size: { width: 4, height: 2 },
          render() { throw new Error("Native source failed"); },
          png() { throw new Error("PNG must not run"); },
          serialize() { throw new Error("Serialization must not run"); },
          dispose() { disposed++; },
        };
      },
    };
    await expect(fileToSource(new File([svg], "Native.svg", { type: "image/svg+xml" }), renderer)).rejects.toThrow("Native source failed");
    expect(disposed).toBe(1);
    const native = await createSvgRenderer(await Bun.file(new URL("../public/renderer/kor.wasm", import.meta.url)).arrayBuffer());
    await expect(fileToSource(new File(['<svg width="4" height="2"><image href="https://example.invalid/x.png"/></svg>'], "External.svg", { type: "image/svg+xml" }), native)).rejects.toThrow("image");
  });
});


describe("bounded exact embedded PNG restoration", () => {
  function chunk(type: string, data: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(data.length + 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, data.length);
    bytes.set(new TextEncoder().encode(type), 4);
    bytes.set(data, 8);
    // Independent bitwise CRC reference, not the decoder's table.
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(4, bytes.length - 4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
    return bytes;
  }

  function png(rows: number[], width = 2, height = 2, color = 6, options: { depth?: number; interlace?: number; before?: Uint8Array[]; imageData?: Uint8Array[] } = {}): Uint8Array {
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header[8] = options.depth ?? 8;
    header[9] = color;
    header[12] = options.interlace ?? 0;
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), ...(options.before ?? []), ...(options.imageData ?? [chunk("IDAT", deflateSync(new Uint8Array(rows)))]), chunk("IEND", new Uint8Array())];
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return bytes;
  }

  test("reverses all five RGBA8 row filters without changing straight channel bytes", async () => {
    const expected = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]);
    const fixtures = [
      [0, 10, 20, 30, 40, 50, 60, 70, 80, 0, 90, 100, 110, 120, 130, 140, 150, 160],
      [1, 10, 20, 30, 40, 40, 40, 40, 40, 1, 90, 100, 110, 120, 40, 40, 40, 40],
      [2, 10, 20, 30, 40, 50, 60, 70, 80, 2, 80, 80, 80, 80, 80, 80, 80, 80],
      [3, 10, 20, 30, 40, 45, 50, 55, 60, 3, 85, 90, 95, 100, 60, 60, 60, 60],
      [4, 10, 20, 30, 40, 40, 40, 40, 40, 4, 80, 80, 80, 80, 40, 40, 40, 40],
    ];
    for (const rows of fixtures) expect(await decodeSourcePng(png(rows))).toEqual({ width: 2, height: 2, pixels: expected });
    const wrapped = await decodeSourcePng(png([0, 250, 251, 252, 253, 2, 7, 7, 7, 7], 1, 2));
    expect(wrapped.pixels).toEqual(new Uint8ClampedArray([250, 251, 252, 253, 1, 2, 3, 4]));
  });

  test("expands RGB8 to opaque RGBA and accepts consecutive split image-data chunks", async () => {
    const rows = [4, 10, 20, 30, 40, 40, 40, 4, 80, 80, 80, 40, 40, 40];
    const compressed = deflateSync(new Uint8Array(rows));
    const decoded = await decodeSourcePng(png(rows, 2, 2, 2, { imageData: [chunk("IDAT", compressed.subarray(0, 5)), chunk("IDAT", compressed.subarray(5))] }));
    expect(decoded.pixels).toEqual(new Uint8ClampedArray([10, 20, 30, 255, 50, 60, 70, 255, 90, 100, 110, 255, 130, 140, 150, 255]));
  });

  test("validates PNG chunks and checksums before decoding compressed bytes", async () => {
    const valid = png([0, 1, 2, 3, 4], 1, 1);
    const damaged = valid.slice(); damaged[29] = damaged[29]! ^ 1;
    await expect(decodeSourcePng(damaged)).rejects.toThrow("checksum");
    await expect(decodeSourcePng(valid.subarray(0, valid.length - 12))).rejects.toThrow("end chunk");
    await expect(decodeSourcePng(new Uint8Array([...valid, 0]))).rejects.toThrow("end chunk");
    await expect(decodeSourcePng(valid.subarray(0, valid.length - 5))).rejects.toThrow("truncated");
    await expect(decodeSourcePng(png([0, 1, 2, 3, 4], 1, 1, 6, { before: [chunk("ABCD", new Uint8Array())] }))).rejects.toThrow("not supported");
    await expect(decodeSourcePng(png([0, 1, 2, 3, 4], 1, 1, 6, { before: [chunk("abca", new Uint8Array())] }))).rejects.toThrow("chunk type");
    await expect(decodeSourcePng(png([0, 1, 2, 3, 4], 1, 1, 6, { before: [chunk("PLTE", new Uint8Array(3)), chunk("PLTE", new Uint8Array(3))] }))).rejects.toThrow("optional palette");
    const compressed = deflateSync(new Uint8Array([0, 1, 2, 3, 4]));
    await expect(decodeSourcePng(png([], 1, 1, 6, { imageData: [chunk("IDAT", compressed.subarray(0, 4)), chunk("tEXt", new Uint8Array()), chunk("IDAT", compressed.subarray(4))] }))).rejects.toThrow("consecutive");
  });

  test("rejects unsupported encoding and impossible dimensions instead of using browser fallback", async () => {
    for (const [width, height] of [[0, 1], [1, 0], [4097, 1], [1, 4097], [0xffffffff, 0xffffffff]]) {
      await expect(decodeSourcePng(png([0, 1, 2, 3, 4], width!, height!))).rejects.toThrow("dimensions");
    }
    await expect(decodeSourcePng(png([], 1, 1, 3))).rejects.toThrow("8-bit RGB or RGBA");
    await expect(decodeSourcePng(png([], 1, 1, 6, { depth: 16 }))).rejects.toThrow("8-bit RGB or RGBA");
    await expect(decodeSourcePng(png([], 1, 1, 6, { interlace: 1 }))).rejects.toThrow("non-interlaced");
    await expect(decodeSourcePng(png([], 1, 1, 2, { before: [chunk("tRNS", new Uint8Array(6))] }))).rejects.toThrow("plain RGB or RGBA");
    await expect(decodeSourcePng(new Uint8Array(50 * 1024 * 1024 + 1))).rejects.toThrow("50 MB");
  });

  test("bounds inflated output and rejects truncated streams or invalid row filters", async () => {
    await expect(decodeSourcePng(png([0, ...Array(100_000).fill(1)], 1, 1))).rejects.toThrow("exceeds the declared dimensions");
    await expect(decodeSourcePng(png([0, 1, 2, 3], 1, 1))).rejects.toThrow("does not match");
    await expect(decodeSourcePng(png([5, 1, 2, 3, 4], 1, 1))).rejects.toThrow("row filter");
    await expect(decodeSourcePng(png([], 1, 1, 6, { imageData: [chunk("IDAT", new Uint8Array([1, 2, 3, 4]))] }))).rejects.toThrow("decompression failed");
    const many = Array.from({ length: 10_000 }, () => chunk("tEXt", new Uint8Array()));
    await expect(decodeSourcePng(png([0, 1, 2, 3, 4], 1, 1, 6, { before: many }))).rejects.toThrow("too many chunks");
  });
});
