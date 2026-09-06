import { cubicBezier, transform } from "motion";
import type { AnimationKeyframe, KeyframeEasing, KeyframePose, KeyframeProperty, KeyframeTrack, PatternParams } from "./types";

const REPEAT_ID = "(?:0|[1-9]\\d?|1[0-3]\\d|14[0-3])";
const GRID_ID = "(?:0|[1-9]\\d{0,2}|10[01]\\d|102[0-3])";
export const CELL_ENTITY_ID_PATTERN = `^cell:${REPEAT_ID}:${GRID_ID}:${GRID_ID}(?![\\s\\S])`;
const CELL_ENTITY_ID = new RegExp(CELL_ENTITY_ID_PATTERN);
export const KEYFRAME_PROPERTIES: readonly KeyframeProperty[] = ["x", "y", "scale", "rotation", "opacity"];
export const KEYFRAME_VALUE_RANGES = {
  x: [-4096, 4096], y: [-4096, 4096], scale: [0, 4], rotation: [-1440, 1440], opacity: [0, 1],
} as const;
export const KEYFRAME_LIMITS = { tracks: 8192, keysPerTrack: 256, totalKeys: 16384 } as const;
const LINEAR: KeyframeEasing = [0, 0, 1, 1];

const KEY_SCHEMA = {
  type: "object", required: ["time", "value"], additionalProperties: false,
  properties: {
    time: { type: "number", minimum: 0, maximum: 60, multipleOf: 0.000001, description: "Seconds within keyframeDuration; unique after canonical rounding." },
    value: { type: "number", multipleOf: 0.000001 },
    easing: { type: "array", minItems: 4, maxItems: 4, default: LINEAR, items: false,
      prefixItems: [0, 1, 2, 3].map((index) => ({ type: "number", minimum: index % 2 === 0 ? 0 : -2,
        maximum: index % 2 === 0 ? 1 : 3, multipleOf: 0.000001 })),
      description: "Outgoing cubic Bézier [x1,y1,x2,y2] to the next key. The final key's curve is retained but unused." },
  },
};

export const KEYFRAME_TRACKS_SCHEMA = {
  type: "array", maxItems: KEYFRAME_LIMITS.tracks,
  items: {
    type: "object", required: ["target", "property", "keyframes"], additionalProperties: false,
    properties: {
      target: { type: "string", anyOf: [{ const: "all" }, { pattern: CELL_ENTITY_ID_PATTERN }] },
      property: { type: "string", enum: KEYFRAME_PROPERTIES },
      keyframes: { type: "array", minItems: 1, maxItems: KEYFRAME_LIMITS.keysPerTrack, items: KEY_SCHEMA },
    },
    allOf: KEYFRAME_PROPERTIES.map((property) => ({
      if: { properties: { property: { const: property } } },
      then: { properties: { keyframes: { items: { properties: { value: {
        minimum: KEYFRAME_VALUE_RANGES[property][0], maximum: KEYFRAME_VALUE_RANGES[property][1],
      } } } } } },
    })),
  },
};

export function compareCellTargets(first: string, second: string): number {
  if (first === second) return 0;
  if (first === "all") return -1;
  if (second === "all") return 1;
  const a = first.split(":").slice(1).map(Number);
  const b = second.split(":").slice(1).map(Number);
  return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
}

function keyframeNumber(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} to ${maximum}.`);
  }
  return Number(value.toFixed(6));
}

/** Validate and canonicalize project/API input before creating numeric Motion evaluators. */
export function parseKeyframeTracks(value: unknown, duration: number): KeyframeTrack[] {
  duration = keyframeNumber(duration, 0.1, 60, "Keyframe duration");
  if (!Array.isArray(value) || value.length > KEYFRAME_LIMITS.tracks) throw new Error("Keyframe tracks must be an array of at most 8,192 tracks.");
  const addresses = new Set<string>();
  let totalKeys = 0;
  return Array.from(value, (entry): KeyframeTrack => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Each keyframe track must be an object.");
    const track = entry as Record<string, unknown>;
    for (const key of Object.keys(track)) {
      if (key !== "target" && key !== "property" && key !== "keyframes") throw new Error(`Unknown keyframe track field “${key}”.`);
    }
    if (typeof track.target !== "string" || (track.target !== "all" && !CELL_ENTITY_ID.test(track.target))) throw new Error("Keyframe target must be all or a supported cell:repeatIndex:row:column address.");
    if (typeof track.property !== "string" || !(KEYFRAME_PROPERTIES as readonly string[]).includes(track.property)) throw new Error("Keyframe property must be x, y, scale, rotation, or opacity.");
    const property = track.property as KeyframeProperty;
    const address = `${track.target}:${property}`;
    if (addresses.has(address)) throw new Error("Keyframe target/property pairs must be unique.");
    addresses.add(address);
    if (!Array.isArray(track.keyframes) || track.keyframes.length === 0 || track.keyframes.length > KEYFRAME_LIMITS.keysPerTrack) throw new Error("Each track needs 1 to 256 keyframes.");
    totalKeys += track.keyframes.length;
    if (totalKeys > KEYFRAME_LIMITS.totalKeys) throw new Error("A scene supports at most 16,384 keyframes.");
    const times = new Set<number>();
    const keyframes = Array.from(track.keyframes, (entry): AnimationKeyframe => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Each keyframe must be an object.");
      const key = entry as Record<string, unknown>;
      for (const name of Object.keys(key)) {
        if (name !== "time" && name !== "value" && name !== "easing") throw new Error(`Unknown keyframe field “${name}”.`);
      }
      const time = keyframeNumber(key.time, 0, 60, "Keyframe time");
      if (time > duration) throw new Error("Keyframe time cannot exceed keyframeDuration.");
      if (times.has(time)) throw new Error("Keyframe times must be unique after rounding to six decimals.");
      times.add(time);
      const [minimum, maximum] = KEYFRAME_VALUE_RANGES[property];
      const value = keyframeNumber(key.value, minimum, maximum, "Keyframe value");
      const rawEasing = key.easing === undefined ? LINEAR : key.easing;
      if (!Array.isArray(rawEasing) || rawEasing.length !== 4) throw new Error("Keyframe easing must contain four Bézier control coordinates.");
      const easing = Array.from(rawEasing, (value, index) => keyframeNumber(value, index % 2 === 0 ? 0 : -2,
        index % 2 === 0 ? 1 : 3, "Bézier control")) as KeyframeEasing;
      return { time, value, easing };
    }).sort((first, second) => first.time - second.time);
    return { target: track.target, property, keyframes };
  }).sort((first, second) => compareCellTargets(first.target, second.target)
    || KEYFRAME_PROPERTIES.indexOf(first.property) - KEYFRAME_PROPERTIES.indexOf(second.property));
}

type KeyframeParams = Pick<PatternParams, "keyframeDuration" | "keyframeLoop" | "keyframeTracks">;
export type KeyframeEvaluator = (target: string, time: number) => KeyframePose;

/**
 * Compile validated tracks with Motion's public numeric transform and cubicBezier APIs.
 * Call the result with EFFECTIVE seconds (animationTime + input.time), not a wall clock.
 * Cell tracks replace all-cell tracks per channel. x/y/rotation are additive deltas;
 * scale/opacity are multipliers. This evaluator has no source sampling or DOM state.
 */
export function createKeyframeEvaluator(params: KeyframeParams): KeyframeEvaluator {
  const duration = params.keyframeDuration;
  const loop = params.keyframeLoop;
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 60) throw new Error("Keyframe duration must be from 0.1 to 60 seconds.");
  const tracks = new Map<string, Partial<Record<KeyframeProperty, (time: number) => number>>>();
  for (const track of params.keyframeTracks) {
    const properties = tracks.get(track.target) ?? {};
    properties[track.property] = transform(track.keyframes.map((key) => key.time), track.keyframes.map((key) => key.value), {
      clamp: true,
      ease: track.keyframes.slice(0, -1).map((key) => cubicBezier(...key.easing)),
    });
    tracks.set(track.target, properties);
  }
  const all = tracks.get("all");
  return (target, time) => {
    if (!Number.isFinite(time)) throw new Error("Keyframe time must be finite.");
    let sampledTime = Math.max(0, Math.min(duration, time));
    if (loop) {
      // Fractional-duration modulo drifts near whole cycles at large persisted cursors.
      const cycles = time / duration;
      const atBoundary = Math.abs(cycles - Math.round(cycles)) <= Number.EPSILON * Math.max(1, Math.abs(cycles)) * 2;
      sampledTime = atBoundary ? 0 : Number((((time % duration) + duration) % duration).toFixed(12)) % duration;
    }
    const selected = tracks.get(target);
    const value = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
    for (const property of KEYFRAME_PROPERTIES) {
      const interpolate = selected?.[property] ?? all?.[property];
      if (interpolate) value[property] = interpolate(sampledTime);
    }
    value.scale = Math.max(0, Math.min(4, value.scale));
    value.opacity = Math.max(0, Math.min(1, value.opacity));
    return value;
  };
}
