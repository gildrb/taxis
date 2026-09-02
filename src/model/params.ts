import type { OrbParams } from "./types";

export const DEFAULT_PARAMS: OrbParams = {
  mode: "hybrid",
  slices: 22,
  dots: 34,
  thickness: 0.72,
  spacing: 0.28,
  taper: 0.42,
  curvature: 0.16,
  threshold: 0.32,
  contrast: 1.45,
  inversion: false,
  crop: 1,
  palette: ["#d8ff68", "#62dfc2"],
  resolution: 1024,
  seed: 27,
  breathing: 0.055,
  wave: 0.075,
  phase: 0,
  rotation: 0,
  noise: 0.08,
  pointer: 0.16,
  audio: 0,
  duration: 4,
  fps: 60,
};

export const PRESETS: ReadonlyArray<{ name: string; params: Partial<OrbParams> }> = [
  {
    name: "Signal",
    params: {
      mode: "hybrid",
      slices: 24,
      dots: 38,
      thickness: 0.72,
      spacing: 0.28,
      taper: 0.42,
      curvature: 0.14,
      palette: ["#d8ff68", "#62dfc2"],
    },
  },
  {
    name: "Index",
    params: {
      mode: "slices",
      slices: 31,
      thickness: 0.52,
      spacing: 0.42,
      taper: 0.66,
      curvature: -0.12,
      palette: ["#f2f0e7", "#9d9a90"],
    },
  },
  {
    name: "Murmur",
    params: {
      mode: "dots",
      slices: 27,
      dots: 44,
      thickness: 0.84,
      spacing: 0.18,
      taper: 0.25,
      noise: 0.2,
      palette: ["#ff826b", "#8b78ff"],
    },
  },
  {
    name: "Current",
    params: {
      mode: "hybrid",
      slices: 16,
      dots: 28,
      thickness: 0.9,
      wave: 0.16,
      curvature: 0.32,
      palette: ["#73e5ff", "#6690ff"],
    },
  },
];

export const PALETTES: ReadonlyArray<{ name: string; colors: [string, string] }> = [
  { name: "Acid mint", colors: ["#d8ff68", "#62dfc2"] },
  { name: "Infra violet", colors: ["#ff826b", "#8b78ff"] },
  { name: "Blue hour", colors: ["#73e5ff", "#6690ff"] },
  { name: "Graphite", colors: ["#f2f0e7", "#88867f"] },
  { name: "Solar", colors: ["#fff2a1", "#ff9f52"] },
];

export const LOCKABLE_KEYS: ReadonlyArray<keyof OrbParams> = [
  "mode",
  "slices",
  "dots",
  "thickness",
  "spacing",
  "taper",
  "curvature",
  "threshold",
  "contrast",
  "inversion",
  "crop",
  "palette",
  "resolution",
  "seed",
  "breathing",
  "wave",
  "phase",
  "rotation",
  "noise",
  "pointer",
  "audio",
  "duration",
  "fps",
];

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function randomizeParams(
  params: OrbParams,
  locks: ReadonlySet<keyof OrbParams>,
): OrbParams {
  const random = mulberry32(params.seed + 1);
  const modes = ["slices", "dots", "hybrid"] as const;
  const palette = PALETTES[Math.floor(random() * PALETTES.length)] ?? PALETTES[0]!;
  const next: OrbParams = {
    ...params,
    mode: modes[Math.floor(random() * modes.length)] ?? "hybrid",
    slices: Math.round(12 + random() * 32),
    dots: Math.round(20 + random() * 36),
    thickness: 0.45 + random() * 0.48,
    spacing: 0.1 + random() * 0.55,
    taper: random() * 0.8,
    curvature: -0.35 + random() * 0.7,
    threshold: 0.18 + random() * 0.44,
    contrast: 0.9 + random() * 1.8,
    crop: 0.75 + random() * 0.55,
    palette: [...palette.colors],
    breathing: random() * 0.12,
    wave: random() * 0.2,
    phase: random(),
    rotation: -12 + random() * 24,
    noise: random() * 0.24,
    seed: (params.seed + 1) % 10_000,
  };

  for (const key of locks) {
    Object.assign(next, { [key]: params[key] });
  }
  return next;
}

export function parsePreset(value: unknown): OrbParams {
  if (!value || typeof value !== "object") throw new Error("Preset must be an object.");
  const candidate = value as { params?: unknown };
  const rawValue = candidate.params ?? candidate;
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    throw new Error("Preset parameters must be an object.");
  }
  const raw = rawValue as Record<string, unknown>;
  const next: OrbParams = { ...DEFAULT_PARAMS, palette: [...DEFAULT_PARAMS.palette] };
  const ranges: Record<string, readonly [number, number]> = {
    slices: [6, 64],
    dots: [8, 72],
    thickness: [0.1, 1],
    spacing: [0, 0.9],
    taper: [0, 1],
    curvature: [-0.6, 0.6],
    threshold: [0, 1],
    contrast: [0.2, 3],
    crop: [0.5, 1.6],
    seed: [0, 9_999],
    breathing: [0, 0.25],
    wave: [0, 0.35],
    phase: [0, 1],
    rotation: [-180, 180],
    noise: [0, 0.5],
    pointer: [0, 1],
    audio: [0, 1],
    duration: [1, 12],
  };
  const target = next as unknown as Record<string, unknown>;
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    const field = raw[key];
    if (field === undefined) continue;
    if (typeof field !== "number" || !Number.isFinite(field) || field < minimum || field > maximum) {
      throw new Error(`Preset field “${key}” is outside its supported range.`);
    }
    target[key] = field;
  }
  if (raw.mode !== undefined) {
    if (raw.mode !== "slices" && raw.mode !== "dots" && raw.mode !== "hybrid") {
      throw new Error("Preset mode is invalid.");
    }
    next.mode = raw.mode;
  }
  if (raw.inversion !== undefined) {
    if (typeof raw.inversion !== "boolean") throw new Error("Preset inversion must be true or false.");
    next.inversion = raw.inversion;
  }
  if (raw.palette !== undefined) {
    if (!Array.isArray(raw.palette) || raw.palette.length !== 2 || raw.palette.some((color) => typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))) {
      throw new Error("Preset palette must contain two six-digit hex colors.");
    }
    next.palette = [raw.palette[0] as string, raw.palette[1] as string];
  }
  if (raw.resolution !== undefined) {
    if (![512, 1024, 2048, 4096].includes(raw.resolution as number)) throw new Error("Preset resolution is invalid.");
    next.resolution = raw.resolution as number;
  }
  if (raw.fps !== undefined) {
    if (![24, 30, 60].includes(raw.fps as number)) throw new Error("Preset frame rate is invalid.");
    next.fps = raw.fps as number;
  }
  return next;
}
