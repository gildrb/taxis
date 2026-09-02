import type { PatternParams, SourceData } from "./types";

export const DEFAULT_PARAMS: PatternParams = {
  preset: "bars",
  cellSize: 48,
  rowShift: 36,
  colorMode: "custom",
  monoColor: "#f5f5f0",
  sourceBackground: 0,
  invert: false,
  contrast: 1,
  luminanceBias: 0,
  colorCount: 2,
  backgroundColor: "#f7f6f3",
  colors: ["#f7f6f3", "#1d1c1a", "#1d1c1a", "#1d1c1a"],
  transparent: false,
  fit: "contain",
  sampleChannel: "auto",
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  width: 720,
  height: 720,
};

export interface PatternRecipe {
  name: string;
  description: string;
  params: Partial<PatternParams>;
  source?: "radial";
}

export const PRESETS: ReadonlyArray<PatternRecipe> = [
  {
    name: "Sliced Sphere",
    description: "Large horizontal cells",
    source: "radial",
    params: {
      preset: "bars",
      width: 720,
      height: 720,
      fit: "contain",
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      sampleChannel: "auto",
      cellSize: 48,
      rowShift: 36,
      colorMode: "custom",
      colorCount: 2,
      backgroundColor: "#f7f6f3",
      colors: ["#f7f6f3", "#1d1c1a", "#1d1c1a", "#1d1c1a"],
      invert: false,
      contrast: 1.4,
      luminanceBias: 0,
    },
  },
  {
    name: "Light Raster",
    description: "Dense vertical luminance field",
    params: {
      preset: "candles",
      cellSize: 12,
      rowShift: 0,
      colorMode: "custom",
      colorCount: 4,
      backgroundColor: "#f7f7f5",
      colors: ["#d8d8d5", "#aaa9a6", "#696866", "#1d1c1a"],
      invert: true,
      contrast: 1.2,
      luminanceBias: 0,
    },
  },
  {
    name: "Dark Raster",
    description: "Low-contrast vertical texture",
    params: {
      preset: "candles",
      cellSize: 28,
      rowShift: 0,
      colorMode: "custom",
      colorCount: 4,
      backgroundColor: "#18181b",
      colors: ["#27272a", "#3f3f46", "#52525b", "#71717a"],
      invert: true,
      contrast: 1.15,
      luminanceBias: -0.08,
    },
  },
  {
    name: "Source Mosaic",
    description: "Keep sampled source color",
    params: {
      preset: "shapes",
      cellSize: 18,
      rowShift: 0,
      colorMode: "source",
      sourceBackground: 0.08,
      invert: false,
      contrast: 1,
      luminanceBias: 0,
    },
  },
];

const NUMBER_RANGES: Record<string, readonly [number, number]> = {
  cellSize: [4, 160],
  rowShift: [0, 240],
  sourceBackground: [0, 1],
  contrast: [0.1, 4],
  luminanceBias: [-1, 1],
  scale: [0.1, 4],
  offsetX: [-1, 1],
  offsetY: [-1, 1],
  width: [1, 4096],
  height: [1, 4096],
};

export function applyPreset(params: PatternParams, partial: Partial<PatternParams>): PatternParams {
  return {
    ...params,
    ...partial,
    colors: partial.colors ? [...partial.colors] : [...params.colors],
  };
}

export function parsePreset(value: unknown): PatternParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Project settings must be an object.");
  }
  const candidate = value as { params?: unknown };
  const rawValue = candidate.params ?? candidate;
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    throw new Error("Project parameters must be an object.");
  }
  const raw = rawValue as Record<string, unknown>;
  const next: PatternParams = { ...DEFAULT_PARAMS, colors: [...DEFAULT_PARAMS.colors] };
  const target = next as unknown as Record<string, unknown>;

  for (const [key, [minimum, maximum]] of Object.entries(NUMBER_RANGES)) {
    const field = raw[key];
    if (field === undefined) continue;
    if (typeof field !== "number" || !Number.isFinite(field) || field < minimum || field > maximum) {
      throw new Error(`Project field “${key}” is outside its supported range.`);
    }
    target[key] = key === "cellSize" || key === "width" || key === "height" ? Math.round(field) : field;
  }

  if (raw.preset !== undefined) {
    if (raw.preset !== "bars" && raw.preset !== "candles" && raw.preset !== "shapes") {
      throw new Error("Pattern preset is invalid.");
    }
    next.preset = raw.preset;
  }
  if (raw.colorMode !== undefined) {
    if (raw.colorMode !== "custom" && raw.colorMode !== "monochrome" && raw.colorMode !== "source") {
      throw new Error("Color mode is invalid.");
    }
    next.colorMode = raw.colorMode;
  }
  if (raw.fit !== undefined) {
    if (raw.fit !== "contain" && raw.fit !== "cover" && raw.fit !== "stretch") {
      throw new Error("Source fit is invalid.");
    }
    next.fit = raw.fit;
  }
  if (raw.sampleChannel !== undefined) {
    if (raw.sampleChannel !== "auto" && raw.sampleChannel !== "alpha" && raw.sampleChannel !== "luminance") {
      throw new Error("Sample channel is invalid.");
    }
    next.sampleChannel = raw.sampleChannel;
  }
  for (const key of ["invert", "transparent"] as const) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== "boolean") throw new Error(`Project field “${key}” must be true or false.`);
      next[key] = raw[key];
    }
  }
  if (raw.colorCount !== undefined) {
    if (raw.colorCount !== 2 && raw.colorCount !== 3 && raw.colorCount !== 4) {
      throw new Error("Color count must be 2, 3, or 4.");
    }
    next.colorCount = raw.colorCount;
  }
  for (const key of ["monoColor", "backgroundColor"] as const) {
    if (raw[key] !== undefined) {
      if (!isHex(raw[key])) throw new Error(`Project field “${key}” must be a six-digit hex color.`);
      next[key] = raw[key];
    }
  }
  if (raw.colors !== undefined) {
    if (!Array.isArray(raw.colors) || raw.colors.length !== 4 || raw.colors.some((color) => !isHex(color))) {
      throw new Error("Project colors must contain four six-digit hex colors.");
    }
    next.colors = [raw.colors[0] as string, raw.colors[1] as string, raw.colors[2] as string, raw.colors[3] as string];
  }
  return next;
}

export function outputSizeForSource(source: SourceData): Pick<PatternParams, "width" | "height"> {
  const longestEdge = Math.max(source.width, source.height);
  const scale = longestEdge < 256 ? 256 / longestEdge : 1;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export function projectFingerprint(params: PatternParams, source: SourceData): string {
  const value = `${JSON.stringify(params)}:${source.fingerprint}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
