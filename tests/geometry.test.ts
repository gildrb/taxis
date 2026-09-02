import { describe, expect, test } from "bun:test";
import { generateGeometry, geometryToSvg, mixColor } from "../src/model/geometry";
import { createRadialMask, isAcceptedImage } from "../src/model/mask";
import { DEFAULT_PARAMS, parsePreset, randomizeParams } from "../src/model/params";
import type { OrbParams, RenderInput } from "../src/model/types";

function input(params: Partial<OrbParams> = {}): RenderInput {
  return {
    params: { ...DEFAULT_PARAMS, ...params, palette: [...DEFAULT_PARAMS.palette] },
    mask: createRadialMask(32),
    time: 0,
    pointer: [0, 0],
    audio: 0,
  };
}

describe("deterministic orb geometry", () => {
  test("returns identical geometry for identical inputs", () => {
    const model = input();
    expect(generateGeometry(model)).toEqual(generateGeometry(model));
  });

  test("creates native SVG shapes and embeds the parameter model", () => {
    const svg = geometryToSvg(input({ mode: "hybrid" }));
    expect(svg).toStartWith("<svg");
    expect(svg).toContain("<metadata>");
    expect(svg).toMatch(/<(rect|circle) /);
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("data:image");
  });

  test("supports slice, dot, and hybrid topology", () => {
    const slices = generateGeometry(input({ mode: "slices" }));
    const dots = generateGeometry(input({ mode: "dots" }));
    const hybrid = generateGeometry(input({ mode: "hybrid" }));
    expect(slices.every((shape) => shape.kind === "rect")).toBe(true);
    expect(dots.every((shape) => shape.kind === "circle")).toBe(true);
    expect(hybrid.some((shape) => shape.kind === "rect")).toBe(true);
    expect(hybrid.some((shape) => shape.kind === "circle")).toBe(true);
  });

  test("the animation closes at the loop boundary", () => {
    const start = geometryToSvg(input());
    const end = geometryToSvg({ ...input(), time: 1 });
    expect(end).toBe(start);
  });
});

describe("parameters", () => {
  test("seeded randomization is reproducible and honors locks", () => {
    const locks = new Set<keyof OrbParams>(["slices", "palette"]);
    const first = randomizeParams(DEFAULT_PARAMS, locks);
    const second = randomizeParams(DEFAULT_PARAMS, locks);
    expect(first).toEqual(second);
    expect(first.slices).toBe(DEFAULT_PARAMS.slices);
    expect(first.palette).toBe(DEFAULT_PARAMS.palette);
    expect(first.seed).toBe(DEFAULT_PARAMS.seed + 1);
  });

  test("imports either a wrapped or direct preset", () => {
    expect(parsePreset({ params: { slices: 12 } }).slices).toBe(12);
    expect(parsePreset({ mode: "dots" }).mode).toBe("dots");
    expect(() => parsePreset(null)).toThrow();
    expect(() => parsePreset({ palette: ["#000000"] })).toThrow();
    expect(() => parsePreset({ duration: 0 })).toThrow();
    expect(() => parsePreset({ resolution: 100_000 })).toThrow();
  });

  test("interpolates palette colors", () => {
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("rgb(128 128 128)");
  });

  test("accepts all required image formats", () => {
    for (const name of ["x.png", "x.jpg", "x.jpeg", "x.webp", "x.avif", "x.svg"]) {
      expect(isAcceptedImage({ name, type: "" } as File)).toBe(true);
    }
    expect(isAcceptedImage({ name: "x.gif", type: "image/gif" } as File)).toBe(false);
  });
});
