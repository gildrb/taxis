import { describe, expect, test } from "bun:test";
import { cubicBezier, transform } from "motion";
import { createKeyframeEvaluator, KEYFRAME_LIMITS, KEYFRAME_PROPERTIES } from "../src/model/keyframes";
import { DEFAULT_PARAMS, PARAMETER_SCHEMA, applyPreset, parsePreset, projectFingerprint } from "../src/model/params";
import { generatePattern, patternToSvg, projectFor } from "../src/model/pattern";
import { parseProject } from "../src/model/project";
import { createRadialSource } from "../src/model/source";
import { createSvgRenderer } from "../src/render/native";
import { renderScene } from "../src/render/scene";
import type { KeyframeEasing, KeyframeProperty, KeyframeTrack, PatternParams, RenderInput } from "../src/model/types";

const source = createRadialSource(64);
const linear: KeyframeEasing = [0, 0, 1, 1];
const renderer = await createSvgRenderer(await Bun.file(new URL("../public/renderer/kor.wasm", import.meta.url)).arrayBuffer());

function track(property: KeyframeProperty, values: [number, number][], target = "all", easing = linear): KeyframeTrack {
  return { target, property, keyframes: values.map(([time, value]) => ({ time, value, easing: [...easing] })) };
}

function input(overrides: Partial<PatternParams> = {}, time = 0): RenderInput {
  return { source, time, params: parsePreset({ ...DEFAULT_PARAMS, width: 100, height: 100,
    sourceMode: "ignore", cellSize: 20, cellPadding: 6, ...overrides }) };
}

describe("strict canonical keyframe scenes", () => {
  test("empty defaults and all channel/curve limits are discoverable", () => {
    expect(DEFAULT_PARAMS).toMatchObject({ keyframeDuration: 4, keyframeLoop: false, keyframeTracks: [] });
    expect(KEYFRAME_LIMITS).toEqual({ tracks: 8192, keysPerTrack: 256, totalKeys: 16384 });
    expect(PARAMETER_SCHEMA.properties.keyframeDuration).toMatchObject({ minimum: 0.1, maximum: 60, multipleOf: 0.000001 });
    expect(PARAMETER_SCHEMA.properties.keyframeLoop).toMatchObject({ type: "boolean", default: false });
    expect(PARAMETER_SCHEMA.properties.keyframeTracks).toMatchObject({ type: "array", maxItems: 8192,
      items: { required: ["target", "property", "keyframes"], additionalProperties: false, properties: {
        property: { enum: ["x", "y", "scale", "rotation", "opacity"] },
        keyframes: { minItems: 1, maxItems: 256, items: { additionalProperties: false,
          properties: { easing: { minItems: 4, maxItems: 4, default: [0, 0, 1, 1] } } } },
      } } });
    expect(Object.keys(PARAMETER_SCHEMA.properties)).toEqual(Object.keys(DEFAULT_PARAMS));
  });

  test("canonicalizes target/property/key order, precision and omitted outgoing easing without mutation", () => {
    const raw = { keyframeDuration: 4.1234567, keyframeTracks: [
      { target: "cell:0:10:0", property: "rotation", keyframes: [{ time: 2, value: 90 }] },
      { target: "cell:0:2:0", property: "x", keyframes: [{ time: 2, value: 17.1234567 }, { time: 0.1234567, value: 0, easing: [0.1234567, -1, 0.9, 2] }] },
      { target: "all", property: "opacity", keyframes: [{ time: 0, value: 1 }] },
      { target: "all", property: "x", keyframes: [{ time: 0, value: 0 }] },
    ] };
    const saved = structuredClone(raw);
    const params = parsePreset(raw);
    expect(raw).toEqual(saved);
    expect(params.keyframeDuration).toBe(4.123457);
    expect(params.keyframeTracks.map((track) => [track.target, track.property])).toEqual([
      ["all", "x"], ["all", "opacity"], ["cell:0:2:0", "x"], ["cell:0:10:0", "rotation"],
    ]);
    expect(params.keyframeTracks[2]!.keyframes).toEqual([
      { time: 0.123457, value: 0, easing: [0.123457, -1, 0.9, 2] },
      { time: 2, value: 17.123457, easing: linear },
    ]);
    expect(parsePreset({ keyframeDuration: 0.1234564, keyframeTracks: [{ target: "all", property: "x",
      keyframes: [{ time: 0.1234564, value: 0 }] }] })).toMatchObject({ keyframeDuration: 0.123456,
        keyframeTracks: [{ keyframes: [{ time: 0.123456 }] }] });
  });

  test("round-trips scene fingerprints including per-key easing, with independent copies", () => {
    const params = parsePreset({ keyframeDuration: 2, keyframeLoop: true,
      keyframeTracks: [track("x", [[0, 0], [2, 12]]), track("opacity", [[0, 1], [2, 0.5]], "cell:0:1:1")] });
    const project = projectFor({ params, source });
    expect(parseProject(project).params).toEqual(params);
    expect(projectFingerprint(parsePreset({ ...params, keyframeTracks: [...params.keyframeTracks].reverse()
      .map((track) => ({ ...track, keyframes: [...track.keyframes].reverse() })) }), source)).toBe(project.fingerprint);
    for (const update of [{ keyframeDuration: 3 }, { keyframeLoop: false }, { keyframeTracks: [] }]) {
      expect(projectFingerprint(parsePreset({ ...params, ...update }), source)).not.toBe(project.fingerprint);
    }
    const copied = applyPreset(params, {});
    copied.keyframeTracks[0]!.keyframes[0]!.easing[1] = 0.3;
    expect(params.keyframeTracks[0]!.keyframes[0]!.easing).toEqual(linear);
    expect(projectFingerprint(copied, source)).not.toBe(project.fingerprint);
  });

  test("rejects malformed tracks, duplicate addresses/times and invalid channel/curve values", () => {
    for (const invalid of [{ keyframeDuration: 0 }, { keyframeDuration: 60.01 }, { keyframeDuration: Infinity },
      { keyframeLoop: 1 }, { keyframeTracks: null }, { keyframeTracks: {} }]) expect(() => parsePreset(invalid)).toThrow();
    const valid = track("x", [[0, 0], [1, 10]]);
    for (const keyframeTracks of [[null], [{}], [valid, valid], [{ ...valid, target: "cell:144:0:0" }],
      [{ ...valid, target: "cell:0:0:0\n" }], [{ ...valid, target: "cell:00:0:0" }], [{ ...valid, target: "group" }],
      [{ ...valid, property: "color" }], [{ ...valid, enabled: true }], [{ ...valid, keyframes: [] }],
      [{ ...valid, keyframes: [null] }], [{ ...valid, keyframes: [{ time: 0, value: 0 }, { time: 0.0000001, value: 1 }] }],
      [{ ...valid, keyframes: [{ time: 5, value: 0 }] }], [{ ...valid, keyframes: [{ time: -1, value: 0 }] }],
      [{ ...valid, keyframes: [{ time: 0, value: 4097 }] }], [{ ...valid, keyframes: [{ time: 0, value: NaN }] }],
      [{ ...valid, keyframes: [{ time: 0, value: 0, hold: true }] }],
      [{ ...valid, keyframes: [{ time: 0, value: 0, easing: "linear" }] }],
      [{ ...valid, keyframes: [{ time: 0, value: 0, easing: [0, 0, 1] }] }],
      [{ ...valid, keyframes: [{ time: 0, value: 0, easing: new Array(4) }] }],
      [{ ...valid, keyframes: [{ time: 0, value: 0, easing: [-0.1, 0, 1, 1] }] }],
      [{ ...valid, keyframes: [{ time: 0, value: 0, easing: [0, -2.1, 1, 1] }] }],
      [{ ...valid, keyframes: [{ time: 0, value: 0, easing: [0, 0, 1.1, 1] }] }],
      [{ ...valid, keyframes: [{ time: 0, value: 0, easing: [0, 0, 1, 3.1] }] }]]) {
      expect(() => parsePreset({ keyframeTracks })).toThrow();
    }
    for (const [property, value] of [["scale", -0.1], ["scale", 4.1], ["opacity", 1.1], ["rotation", 1441]] as const) {
      expect(() => parsePreset({ keyframeTracks: [track(property, [[0, value]])] })).toThrow();
    }
  });

  test("bounds total authoring work before evaluating Motion curves", () => {
    expect(() => parsePreset({ keyframeTracks: new Array(8193).fill(null) })).toThrow("8,192");
    expect(() => parsePreset({ keyframeTracks: [{ target: "all", property: "x", keyframes: new Array(257).fill({ time: 0, value: 0 }) }] })).toThrow("256");
    const keys = Array.from({ length: 256 }, (_, index) => ({ time: index / 5, value: index }));
    const tracks = Array.from({ length: 65 }, (_, index) => ({ target: `cell:0:0:${index}`, property: "x", keyframes: keys }));
    expect(() => parsePreset({ keyframeDuration: 60, keyframeTracks: tracks })).toThrow("16,384");
  });
});

describe("Motion's deterministic numeric timeline", () => {
  test("samples neutral, single-key and nonuniform linear channels without browser state", () => {
    const empty = createKeyframeEvaluator(DEFAULT_PARAMS);
    expect(empty("all", 900)).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    const params = parsePreset({ keyframeDuration: 4, keyframeTracks: [track("x", [[2, 7]]),
      track("y", [[0, 0], [1, 10], [4, 40]]), track("scale", [[0, 1], [4, 2]]),
      track("rotation", [[0, 0], [4, 720]]), track("opacity", [[0, 0.1], [4, 0.9]])] });
    const sample = createKeyframeEvaluator(params);
    expect(sample("cell:0:2:2", 2)).toEqual({ x: 7, y: 20, scale: 1.5, rotation: 360, opacity: 0.5 });
    expect(sample("all", -100).x).toBe(7);
    expect(sample("all", 100).x).toBe(7);
    expect(() => sample("all", Infinity)).toThrow("finite");
    expect(() => sample("all", NaN)).toThrow("finite");
  });

  test("actual Motion cubic Bézier shapes each outgoing segment, not the following segment", () => {
    const curved = track("x", [[0, 0], [1, 100], [2, 200]], "all", [0.5, 0, 0.5, 0]);
    curved.keyframes[1]!.easing = linear;
    curved.keyframes[2]!.easing = [0, -2, 1, 3];
    const sample = createKeyframeEvaluator(parsePreset({ keyframeDuration: 2, keyframeTracks: [curved] }));
    const reference = transform([0, 1, 2], [0, 100, 200], { clamp: true,
      ease: [cubicBezier(0.5, 0, 0.5, 0), cubicBezier(...linear)] });
    expect(sample("all", 0.5).x).toBeCloseTo(12.5, 8);
    expect(sample("all", 0.5).x).not.toBe(50);
    expect(sample("all", 1.5).x).toBe(150);
    for (const time of [0, 0.1, 0.375, 0.75, 1, 1.5, 2, 20]) expect(sample("all", time).x).toBe(reference(time));
  });

  test("clamp holds first/last keys; loop wraps exact/negative times with no last-to-first tween", () => {
    const params = parsePreset({ keyframeDuration: 4, keyframeTracks: [track("x", [[1, 10], [3, 30]])] });
    const clamped = createKeyframeEvaluator(params);
    for (const time of [-2, 0, 1]) expect(clamped("all", time).x).toBe(10);
    for (const time of [3, 4, 100]) expect(clamped("all", time).x).toBe(30);
    const looped = createKeyframeEvaluator({ ...params, keyframeLoop: true });
    for (const time of [0, 4, 8, -4]) expect(looped("all", time).x).toBe(10);
    expect(looped("all", -1).x).toBe(30);
    expect(looped("all", 3.5).x).toBe(30);
    expect(looped("all", 2)).toEqual(looped("all", 10));
    const fractional = createKeyframeEvaluator(parsePreset({ keyframeDuration: 0.1, keyframeLoop: true, keyframeTracks: [track("x", [[0, 0], [0.1, 100]])] }));
    for (const time of [0.3, -0.2, 3.7, 86400.3, 86400.4, -86400.3, -86400.4]) {
      expect(fractional("all", time).x).toBe(0);
    }
    expect(fractional("all", 86400.4 - 0.000001).x).toBeGreaterThan(99);
  });

  test("per-cell channels replace all-cell fallback rather than adding twice", () => {
    const params = parsePreset({ keyframeTracks: [track("x", [[0, 0], [2, 40]]), track("scale", [[0, 1], [2, 2]]),
      track("x", [[0, 5]], "cell:0:2:2"), track("rotation", [[0, 45]], "cell:0:2:2")] });
    const sample = createKeyframeEvaluator(params);
    expect(sample("cell:0:2:2", 1)).toEqual({ x: 5, y: 0, scale: 1.5, rotation: 45, opacity: 1 });
    expect(sample("cell:0:2:3", 1)).toEqual({ x: 20, y: 0, scale: 1.5, rotation: 0, opacity: 1 });
    expect(sample("all", 1)).toEqual(sample("cell:0:2:3", 1));
    const compiled = createKeyframeEvaluator(params);
    params.keyframeLoop = true;
    params.keyframeDuration = 1;
    params.keyframeTracks[0]!.keyframes[1]!.value = 100;
    expect(compiled("all", 10).x).toBe(40); // Compiled snapshot is not mutated behind its caller.
  });

  test("Bézier overshoot remains meaningful but physical scale/opacity never become invalid", () => {
    for (const easing of [[0, 3, 1, 3], [0, -2, 1, -2]] as KeyframeEasing[]) {
      const params = parsePreset({ keyframeDuration: 1, keyframeTracks: [track("x", [[0, 0], [1, 100]], "all", easing),
        track("scale", [[0, 0], [1, 4]], "all", easing), track("opacity", [[0, 0], [1, 1]], "all", easing)] });
      const value = createKeyframeEvaluator(params)("all", 0.5);
      if (easing[1] > 0) expect(value).toMatchObject({ x: 237.5, scale: 4, opacity: 1 });
      else expect(value).toMatchObject({ x: -137.5, scale: 0, opacity: 0 });
    }
  });
});

describe("keyframed native cell entities", () => {
  test("channels compose with each procedural pose without changing rest topology or paint", () => {
    const keyframeTracks = [track("x", [[0, 3]]), track("y", [[0, 5]]), track("rotation", [[0, 30]]),
      track("scale", [[0, 1.25]]), track("opacity", [[0, 0.5]])];
    for (const animation of ["none", "pulse", "rotate", "wave"] as const) {
      const model = input({ animation, animationAmount: 0.5 }, 1);
      const before = generatePattern(model);
      const after = generatePattern({ ...model, params: { ...model.params, keyframeTracks } });
      expect(after.entities!.map((entity) => [entity.id, entity.rest, entity.selected])).toEqual(before.entities!.map((entity) => [entity.id, entity.rest, entity.selected]));
      const base = before.entities!.find((entity) => entity.id === "cell:0:2:2")!;
      const moved = after.entities!.find((entity) => entity.id === base.id)!;
      expect(moved.pose.x).toBeCloseTo(base.pose.x + 3, 8);
      expect(moved.pose.y).toBeCloseTo(base.pose.y + 5, 8);
      expect(moved.pose.rotation).toBe(base.pose.rotation + 30);
      expect(moved.pose.scale).toBe(base.pose.scale * 1.25);
      expect(moved.pose.opacity).toBe(0.5);
      expect(moved.primitive!.opacity).toBe(base.primitive!.opacity * 0.5);
      expect(moved.primitive!.color).toBe(base.primitive!.color);
    }
  });

  test("source and geometric masks select only at rest, even when keyed geometry leaves them", () => {
    const model = input({ sourceMode: "mask", maskShape: "circle", maskScale: 0.6,
      keyframeTracks: [track("x", [[0, 0], [1, 20]])] });
    const before = generatePattern(model);
    const after = generatePattern({ ...model, time: 1 });
    expect(after.entities!.map((entity) => [entity.id, entity.selected])).toEqual(before.entities!.map((entity) => [entity.id, entity.selected]));
    expect(after.entities!.find((entity) => entity.id === "cell:0:2:3")).toMatchObject({ rest: { x: 70, y: 50 },
      pose: { x: 90, y: 50 }, selected: true, visible: true, primitive: { x: 86, width: 8 } });
    expect(patternToSvg({ ...model, time: 1 })).not.toMatch(/<(?:image|mask|clipPath) /);
  });

  test("transparent, collapsed and boundary-culled cells retain their IDs and complete geometry", () => {
    for (const [property, value, hiddenReason] of [["opacity", 0, "opacity"], ["scale", 0, "collapsed"], ["x", 100, "repeat-bounds"]] as const) {
      const model = input({ keyframeTracks: [track(property, [[0, property === "x" ? 0 : 1], [1, value]], "cell:0:2:2")] });
      const before = generatePattern(model);
      const after = generatePattern({ ...model, time: 1 });
      expect(after.entities!.map((entity) => entity.id)).toEqual(before.entities!.map((entity) => entity.id));
      const hidden = after.entities!.find((entity) => entity.id === "cell:0:2:2")!;
      expect(hidden).toMatchObject({ selected: true, visible: false, hiddenReason });
      expect(hidden.primitive).not.toBeNull();
      expect(hidden.primitive!.entityId).toBe(hidden.id);
      expect(after.primitives).not.toContain(hidden.primitive!);
      if (property === "x") expect(hidden.primitive).toMatchObject({ x: 146, width: 8, height: 8 });
    }
    for (const cellShape of ["square", "circle", "triangle", "line", "diamond", "hexagon", "octagon", "polygon"] as const) {
      const frame = generatePattern(input({ cellShape, keyframeTracks: [track("scale", [[0, 0]])] }));
      expect(frame.primitives).toHaveLength(0);
      expect(frame.entities!.every((entity) => entity.hiddenReason === "collapsed")).toBe(true);
      expect(JSON.stringify(frame)).not.toMatch(/NaN|Infinity/);
    }
  });

  test("elapsed cursor, repeated cell IDs and dormant tracks stay deterministic", () => {
    const model = input({ width: 220, layoutColumns: 2, layoutGapX: 20, keyframeLoop: true, keyframeDuration: 2,
      keyframeTracks: [track("x", [[0, 0], [2, 8]], "cell:1:2:2", [0.5, 0, 0.5, 0])] }, 0.75);
    const frame = generatePattern(model);
    const paused = { ...model, params: { ...model.params, animationTime: 0.75 }, time: 0 };
    expect(generatePattern(paused)).toEqual(frame);
    expect(generatePattern({ ...paused, time: 0.5 })).toEqual(generatePattern({ ...model, time: 1.25 }));
    expect(generatePattern({ ...model, time: 2.75 })).toEqual(frame);
    const dormant = { ...model, params: { ...model.params, keyframeTracks: [...model.params.keyframeTracks,
      track("y", [[0, 20]], "cell:143:1023:1023")] } };
    expect(generatePattern(dormant)).toEqual(frame);
    const continuous = { ...model, params: { ...model.params, useCells: false } };
    expect(generatePattern(continuous)).toEqual(generatePattern({ ...continuous, params: { ...continuous.params, keyframeTracks: [] } }));
    const metadata = JSON.parse(patternToSvg(paused).match(/<metadata>(.*?)<\/metadata>/s)![1]!.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
    expect(metadata).toMatchObject({ time: 0, evaluatedTime: 0.75, params: { animationTime: 0.75, keyframeDuration: 2, keyframeLoop: true } });
  });

  test("the native Kor SVG, RGBA and PNG paths share actual eased cell trajectories", () => {
    const model = input({ transparent: true, cellShape: "triangle", keyframeLoop: true, keyframeDuration: 2,
      keyframeTracks: [track("x", [[0, 0], [1, 8], [2, 0]], "all", [0.5, 0, 0.5, 0]),
        track("rotation", [[0, 0], [2, 180]], "cell:0:2:2"), track("opacity", [[0, 0.25], [2, 1]])] }, 0.5);
    const frame = generatePattern(model);
    const svg = renderScene(model, renderer, "svg");
    const rgba = renderScene(model, renderer, "rgba");
    const png = renderScene(model, renderer, "png");
    const text = new TextDecoder().decode(svg);
    expect(text).toBe(patternToSvg(model));
    expect(text.match(/<polygon /g)).toHaveLength(frame.primitives.length);
    expect(text).toContain('data-cell-id="cell:0:2:2"');
    expect(text).not.toMatch(/<(?:image|mask|clipPath) /);
    const document = renderer.createDocument(svg);
    try {
      expect(document.render(100, 100).pixels).toEqual(rgba.pixels);
      expect(document.png(100, 100)).toEqual(png);
    } finally { document.dispose(); }
    expect(rgba.pixels).not.toEqual(renderScene({ ...model, time: 1 }, renderer, "rgba").pixels);
    expect(rgba.pixels).toEqual(renderScene({ ...model, time: 2.5 }, renderer, "rgba").pixels);
    expect(rgba.pixels).toEqual(renderScene({ ...model, params: { ...model.params, animationTime: 0.5 }, time: 0 }, renderer, "rgba").pixels);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(KEYFRAME_PROPERTIES).toHaveLength(5);
  });
});
