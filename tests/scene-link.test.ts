import { describe, expect, test } from "bun:test";
import { DEFAULT_PARAMS, parsePreset } from "../src/model/params";
import { MAX_SCENE_QUERY_LENGTH, MAX_SCENE_URL_LENGTH, readSceneSettings, writeSceneSettings } from "../src/model/scene-link";
import type { KeyframeTrack } from "../src/model/types";

const small = parsePreset({ ...DEFAULT_PARAMS, width: 1500, height: 1500, animationTime: 0.125 });
const tracks: KeyframeTrack[] = Array.from({ length: 100 }, (_, index) => ({
  target: `cell:0:${Math.floor(index / 10)}:${index % 10}`, property: "y",
  keyframes: [0, 1, 2, 3, 4].map((time) => ({ time, value: time % 2 ? 24 + index : -index, easing: [0.42, 0, 0.58, 1] })),
}));
const large = parsePreset({ ...small, keyframeDuration: 4, keyframeLoop: true, keyframeTracks: tracks });

describe("current-schema scene link transport", () => {
  test("retains small query links and reads existing partial settings", () => {
    const base = new URL("https://taxis.example/editor?panel=canvas#section");
    const original = base.href;
    const url = writeSceneSettings(base, small);
    expect(base.href).toBe(original);
    expect(url.search.length).toBeLessThanOrEqual(MAX_SCENE_QUERY_LENGTH);
    expect(url.searchParams.get("settings")).toBe(JSON.stringify(small));
    expect(url.hash).toBe("#section");
    expect(readSceneSettings(url)).toEqual(small);
    expect(readSceneSettings(new URL(`https://taxis.example/?settings=${encodeURIComponent('{"cellSize":28}')}`))).toEqual(parsePreset({ cellSize: 28 }));
    expect(readSceneSettings(new URL("https://taxis.example/?panel=source#section"))).toBeUndefined();
  });

  test("round-trips all 100 cell keyframe tracks without sending settings to HTTP", () => {
    const base = new URL("https://taxis.example/editor?source=0123456789abcdef&panel=pattern&cell=cell%3A0%3A0%3A0&tag=a&tag=b#tab=motion&note=a%20b&note=c");
    const original = base.href;
    const url = writeSceneSettings(base, large);
    expect(base.href).toBe(original);
    expect(url.searchParams.has("settings")).toBe(false);
    expect(url.search.length).toBeLessThanOrEqual(MAX_SCENE_QUERY_LENGTH);
    expect(url.href.length).toBeGreaterThan(6_000);
    expect(url.href.length).toBeLessThan(MAX_SCENE_URL_LENGTH);
    expect(url.searchParams.getAll("tag")).toEqual(["a", "b"]);
    expect(url.searchParams.get("source")).toBe("0123456789abcdef");
    expect(url.hash.startsWith("#tab=motion&note=a%20b&note=c&settings=")).toBe(true);
    const restored = readSceneSettings(new URL(url.href));
    expect(restored).toEqual(large);
    expect(restored?.keyframeTracks).toHaveLength(100);
  });

  test("switches transports in both directions and removes stale settings only", () => {
    const query = writeSceneSettings(new URL("https://taxis.example/?zoom=1.1#anchor&mode=timeline"), small);
    const fragment = writeSceneSettings(query, large);
    expect(fragment.searchParams.has("settings")).toBe(false);
    expect(new URLSearchParams(fragment.hash.slice(1)).getAll("settings")).toHaveLength(1);
    expect(fragment.hash.startsWith("#anchor&mode=timeline&settings=")).toBe(true);
    const back = writeSceneSettings(fragment, small);
    expect(back.searchParams.getAll("settings")).toHaveLength(1);
    expect(back.hash).toBe("#anchor&mode=timeline");
    expect(back.searchParams.get("zoom")).toBe("1.1");
    expect(readSceneSettings(back)).toEqual(small);
    expect(readSceneSettings(fragment)).toEqual(large);
  });

  test("accounts for unrelated query parameters when selecting the transport", () => {
    const url = writeSceneSettings(new URL(`https://taxis.example/?other=${"x".repeat(5900)}`), small);
    expect(url.searchParams.get("other")).toHaveLength(5900);
    expect(url.searchParams.has("settings")).toBe(false);
    expect(url.search.length).toBeLessThanOrEqual(MAX_SCENE_QUERY_LENGTH);
    expect(readSceneSettings(url)).toEqual(small);
  });

  test("rejects malformed, empty, duplicate, conflicting and invalid-schema settings", () => {
    for (const suffix of ["?settings=", "?settings=%7Bbad", "?settings=null", "?settings=%7B%22unknown%22%3A1%7D", "?settings={}&settings={}", "#settings={}&settings={}", "?settings={}#settings={}", "?settings={}&%73ettings={}"]) {
      expect(() => readSceneSettings(new URL(`https://taxis.example/${suffix}`))).toThrow();
    }
    const conflicting = new URL("https://taxis.example/?settings={}&keep=1#settings={}&keep=2");
    const fixed = writeSceneSettings(conflicting, small);
    expect(readSceneSettings(fixed)).toEqual(small);
    expect(fixed.searchParams.get("keep")).toBe("1");
    expect(fixed.hash).toBe("#keep=2");
  });

  test("rejects unrepresentable links rather than truncating data or mutating the input", () => {
    const longQuery = new URL(`https://taxis.example/?other=${"x".repeat(MAX_SCENE_QUERY_LENGTH)}`);
    const previous = longQuery.href;
    expect(() => writeSceneSettings(longQuery, small)).toThrow("6,000 query characters");
    expect(longQuery.href).toBe(previous);
    const nearLimit = new URL(`https://taxis.example/#note=${"x".repeat(MAX_SCENE_URL_LENGTH - 100)}`);
    expect(() => writeSceneSettings(nearLimit, large)).toThrow("Export Project JSON");
    const overLimit = new URL(`https://taxis.example/#note=${"x".repeat(MAX_SCENE_URL_LENGTH)}`);
    expect(() => readSceneSettings(overLimit)).toThrow("2,000,000");
  });
});
