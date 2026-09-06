import { fingerprintText } from "./fingerprint";
import { parseVectorMask } from "./svg-mask";
import type { CellAnimationOverride, LayoutCellOverride, PatternParams, SourceData, VectorMask } from "./types";
import { CELL_ENTITY_ID_PATTERN, KEYFRAME_TRACKS_SCHEMA, compareCellTargets, parseKeyframeTracks } from "./keyframes";

export const DEFAULT_PARAMS: PatternParams = {
  preset: "bars",
  useCells: true,
  cellShape: "square",
  cellSides: 6,
  cellGapX: 0,
  cellGapY: 0,
  cellPadding: 0,
  cellRotation: 0,
  cellThreshold: 0.5,
  cellSize: 48,
  rowShift: 0,
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
  fit: "cover",
  sampleChannel: "auto",
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  width: 1500,
  height: 1500,
  rowShiftMode: "alternating",
  symmetry: "none",
  motifScale: 1,
  lineWidth: 0.35,
  rotation: 0,
  patternOffsetX: 0,
  patternOffsetY: 0,
  patternScaleX: 1,
  patternScaleY: 1,
  jitter: 0,
  seed: 1,
  radialCount: 24,
  radialBands: 3,
  innerRadius: 0.15,
  radialTwist: 0,
  radialTaper: 0.5,
  maskShape: "none",
  maskSides: 8,
  maskScale: 1,
  maskRotation: 0,
  layoutColumns: 1,
  layoutRows: 1,
  layoutGapX: 0,
  layoutGapY: 0,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  layoutCells: [],
  gradientType: "linear",
  gradientStart: "#1d1c1a",
  gradientEnd: "#d26442",
  gradientAngle: 0,
  gradientCenterX: 0,
  gradientCenterY: 0,
  gradientSpan: 1,
  sourceMode: "sample",
  sourceRotation: 0,
  animation: "none",
  animationAxis: "y",
  animationStagger: 0.1,
  animationStaggerBy: "column",
  cellAnimations: [],
  keyframeDuration: 4,
  keyframeLoop: false,
  keyframeTracks: [],
  animationTime: 0,
  animationDuration: 4,
  animationAmount: 0.2,
  animationPhase: 0,
};

export interface PatternRecipe {
  name: string;
  description: string;
  params: Partial<PatternParams>;
}

const BALANCED: Partial<PatternParams> = {
  useCells: false,
  rowShift: 0,
  rowShiftMode: "alternating",
  symmetry: "none",
  motifScale: 1,
  rotation: 0,
  patternOffsetX: 0,
  patternOffsetY: 0,
  patternScaleX: 1,
  patternScaleY: 1,
  jitter: 0,
  radialTwist: 0,
  sourceRotation: 0,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  sourceMode: "sample",
  animation: "none",
  animationTime: 0,
  animationPhase: 0,
};

export const PRESETS: ReadonlyArray<PatternRecipe> = [
  {
    name: "Sliced Sphere",
    description: "Centered horizontal cells",
    params: {
      ...BALANCED,
      preset: "bars",
      fit: "cover",
      sampleChannel: "auto",
      cellSize: 48,
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
      ...BALANCED,
      preset: "candles",
      cellSize: 12,
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
    name: "Column Wave",
    description: "Independent cells wave vertically by column",
    params: {
      ...BALANCED,
      useCells: true,
      preset: "shapes",
      sourceMode: "ignore",
      cellShape: "square",
      cellSize: 48,
      cellGapX: 12,
      cellGapY: 12,
      cellPadding: 4,
      cellRotation: 0,
      cellThreshold: 0.5,
      cellAnimations: [],
      animation: "wave",
      animationDuration: 4,
      animationAmount: 0.5,
      animationAxis: "y",
      animationStagger: 0.1,
      animationStaggerBy: "column",
      colorMode: "custom",
      colorCount: 2,
      backgroundColor: "#f7f6f3",
      colors: ["#f7f6f3", "#1d1c1a", "#1d1c1a", "#1d1c1a"],
      invert: false,
      contrast: 1,
      luminanceBias: 0,
    },
  },
  {
    name: "Source Mosaic",
    description: "Whole cells keep sampled source color",
    params: {
      ...BALANCED,
      useCells: true,
      preset: "shapes",
      cellShape: "square",
      cellSize: 18,
      cellGapX: 0,
      cellGapY: 0,
      cellPadding: 0,
      cellRotation: 0,
      cellThreshold: 0.5,
      sampleChannel: "alpha",
      colorMode: "source",
      sourceBackground: 0.08,
      invert: false,
      contrast: 1,
      luminanceBias: 0,
    },
  },
  {
    name: "Masked Stripes",
    description: "Even lines inside an SVG shape",
    params: {
      ...BALANCED,
      preset: "stripes",
      sourceMode: "mask",
      fit: "contain",
      cellSize: 48,
      lineWidth: 0.35,
      colorMode: "custom",
      colorCount: 2,
      backgroundColor: "#f7f6f3",
      colors: ["#f7f6f3", "#1d1c1a", "#1d1c1a", "#1d1c1a"],
      invert: false,
      contrast: 1,
      luminanceBias: 0,
    },
  },
  {
    name: "Radial Rays",
    description: "Repeated rays in concentric bands",
    params: {
      ...BALANCED,
      preset: "radial",
      sourceMode: "ignore",
      radialCount: 24,
      radialBands: 3,
      innerRadius: 0.15,
      radialTwist: 0,
      radialTaper: 0.5,
      lineWidth: 0.35,
      colorMode: "custom",
      colorCount: 2,
      backgroundColor: "#f7f6f3",
      colors: ["#f7f6f3", "#1d1c1a", "#1d1c1a", "#1d1c1a"],
      invert: false,
      contrast: 1,
      luminanceBias: 0,
    },
  },
  {
    name: "Concentric Rings",
    description: "Evenly spaced circular lines",
    params: {
      ...BALANCED,
      preset: "rings",
      sourceMode: "ignore",
      cellSize: 32,
      innerRadius: 0.08,
      lineWidth: 0.35,
      colorMode: "custom",
      colorCount: 2,
      backgroundColor: "#f7f6f3",
      colors: ["#f7f6f3", "#1d1c1a", "#1d1c1a", "#1d1c1a"],
      invert: false,
      contrast: 1,
      luminanceBias: 0,
    },
  },
];

const NUMBER_RULES = {
  cellSize: [4, 160, 0],
  cellSides: [3, 32, 0],
  cellGapX: [0, 1024, 0],
  cellGapY: [0, 1024, 0],
  cellPadding: [0, 128, 1],
  cellRotation: [-180, 180, 0],
  cellThreshold: [0, 1, 2],
  rowShift: [0, 240, 0],
  sourceBackground: [0, 1, 2],
  contrast: [0.1, 4, 2],
  luminanceBias: [-1, 1, 2],
  scale: [0.1, 4, 2],
  offsetX: [-1, 1, 2],
  offsetY: [-1, 1, 2],
  width: [1, 4096, 0],
  height: [1, 4096, 0],
  motifScale: [0.1, 2, 2],
  lineWidth: [0.02, 1, 2],
  rotation: [-180, 180, 0],
  patternOffsetX: [-4096, 4096, 0],
  patternOffsetY: [-4096, 4096, 0],
  patternScaleX: [0.1, 4, 2],
  patternScaleY: [0.1, 4, 2],
  jitter: [0, 1, 2],
  seed: [0, 99999, 0],
  radialCount: [3, 128, 0],
  radialBands: [1, 16, 0],
  innerRadius: [0, 0.9, 2],
  radialTwist: [-180, 180, 0],
  radialTaper: [0, 1, 2],
  maskSides: [3, 32, 0],
  maskScale: [0.1, 1, 2],
  maskRotation: [-180, 180, 0],
  layoutColumns: [1, 12, 0],
  layoutRows: [1, 12, 0],
  layoutGapX: [0, 1024, 0],
  layoutGapY: [0, 1024, 0],
  paddingTop: [0, 2048, 0],
  paddingRight: [0, 2048, 0],
  paddingBottom: [0, 2048, 0],
  paddingLeft: [0, 2048, 0],
  gradientAngle: [-180, 180, 0],
  gradientCenterX: [-1, 1, 2],
  gradientCenterY: [-1, 1, 2],
  gradientSpan: [0.1, 2, 2],
  sourceRotation: [-180, 180, 0],
  animationDuration: [0.5, 30, 2],
  animationAmount: [0, 1, 2],
  animationPhase: [0, 1, 3],
  animationStagger: [0, 1, 3],
  animationTime: [0, 86400, 6],
  keyframeDuration: [0.1, 60, 6],
} as const satisfies Partial<Record<keyof PatternParams, readonly [number, number, number]>>;

const ENUM_RULES = {
  cellShape: ["square", "circle", "triangle", "line", "diamond", "hexagon", "octagon", "polygon"],
  preset: ["bars", "candles", "shapes", "stripes", "radial", "rings"],
  colorMode: ["custom", "monochrome", "source", "gradient"],
  fit: ["contain", "cover", "stretch"],
  sampleChannel: ["auto", "alpha", "luminance"],
  rowShiftMode: ["alternating", "wave"],
  symmetry: ["none", "x", "y", "both"],
  maskShape: ["none", "circle", "triangle", "square", "octagon", "polygon"],
  gradientType: ["linear", "radial"],
  sourceMode: ["sample", "mask", "ignore"],
  animation: ["none", "pulse", "rotate", "wave"],
  animationAxis: ["x", "y"],
  animationStaggerBy: ["none", "column", "row", "index"],
} as const satisfies Partial<Record<keyof PatternParams, readonly string[]>>;


const CELL_NUMBER_RULES = {
  index: [0, 143, 0],
  offsetX: [-4096, 4096, 0],
  offsetY: [-4096, 4096, 0],
  scaleX: [0.1, 4, 2],
  scaleY: [0.1, 4, 2],
  rotation: [-180, 180, 0],
  maskRotation: [-180, 180, 0],
  maskScale: [0.1, 1, 2],
  padding: [0, 1024, 0],
} as const;
const CELL_SCHEMA = {
  type: "object",
  required: ["index"],
  additionalProperties: false,
  properties: {
    ...Object.fromEntries(Object.entries(CELL_NUMBER_RULES).map(([key, [minimum, maximum, decimals]]) => [key, {
      type: decimals === 0 ? "integer" : "number", minimum, maximum, multipleOf: 10 ** -decimals,
    }])),
    maskShape: { type: "string", enum: [...ENUM_RULES.maskShape] },
  },
};

const ANIMATION_NUMBERS = ["animationDuration", "animationAmount", "animationPhase", "animationStagger"] as const;
const ANIMATION_ENUMS = ["animation", "animationAxis", "animationStaggerBy"] as const;
const ENTITY_ID = new RegExp(CELL_ENTITY_ID_PATTERN);
const CELL_ANIMATION_SCHEMA = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: CELL_ENTITY_ID_PATTERN, description: "Stable rest-grid address: cell:repeatIndex:row:column." },
    ...Object.fromEntries(ANIMATION_NUMBERS.map((key) => {
      const [minimum, maximum, decimals] = NUMBER_RULES[key];
      return [key, { type: "number", minimum, maximum, multipleOf: 10 ** -decimals }];
    })),
    ...Object.fromEntries(ANIMATION_ENUMS.map((key) => [key, { type: "string", enum: [...ENUM_RULES[key]] }])),
  },
};

const PARAMETER_DESCRIPTIONS: Partial<Record<keyof PatternParams, string>> = {
  useCells: "Generate independently animated complete cells (default). Turn off only for intentional continuous/atlas modes. Masks select cells at rest, never clip moving cells.",
  animation: "Cell-local motion in useCells mode: pulse/rotate about each rest center, wave translates each cell. Global pattern placement remains static.",
  animationAxis: "Translation axis for cell wave motion inside each repeat before static scene placement; y moves cells vertically by default.",
  animationTime: "Persisted elapsed seconds. Evaluation adds input.time to this cursor; pausing must preserve seconds for independent cell durations.",
  animationStagger: "Wave phase offset in cycles per column, row, or rest-grid index. Does not move or resample the rest grid.",
  animationStaggerBy: "Rest-grid coordinate used for cell wave phase offsets; columns by default.",
  cellAnimations: "Sparse animation overrides addressed by stable cell:repeatIndex:row:column IDs. Inactive addresses remain stored. Each cell loops at its own duration.",
  keyframeDuration: "Cell-keyframe timeline duration in seconds. Every key must be within this duration; independent from procedural periods.",
  keyframeLoop: "Loop cell tracks by Euclidean modulo duration; exact end wraps to zero. Off holds first/last values, including at the endpoint. No implicit last-to-first tween.",
  keyframeTracks: "Cell mode only. Unique target/property tracks; per-cell tracks replace all-cell fallback per channel. x/y/rotation add to procedural pose, scale/opacity multiply. Outgoing Bézier easing; at most 16,384 total keys. Sample at animationTime+input.time.",
  cellShape: "Shape of each individual cell when useCells is enabled; not a mask over the whole pattern.",
  cellSize: "Square lattice slot size in pixels. In whole-cell mode, center spacing is cellSize plus cellGapX/Y.",
  cellSides: "Sides of each polygon cell.",
  cellGapX: "Horizontal space added between individual cell slots, in pixels; does not resize the cells.",
  cellGapY: "Vertical space added between individual cell slots, in pixels; does not resize the cells.",
  cellPadding: "Inset on all sides within each individual cell slot, in pixels; does not change center spacing.",
  cellRotation: "Rotation of each complete cell shape within its slot, in degrees.",
  cellThreshold: "Minimum center sample for including a complete cell. Never clips part of a cell.",
  maskShape: "Optional whole-pattern boundary, distinct from cellShape. Whole-cell mode uses center selection rather than clipping.",
  layoutColumns: "Number of full pattern repeats across the canvas; not the number of small cells.",
  layoutRows: "Number of full pattern repeats down the canvas; not the number of small cells.",
  layoutGapX: "Horizontal gap between full pattern repeats, in pixels. Use cellGapX for individual shapes.",
  layoutGapY: "Vertical gap between full pattern repeats, in pixels. Use cellGapY for individual shapes.",
  layoutCells: "Sparse overrides for full pattern repeats, not individual small shapes.",
};

export const PARAMETER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(Object.entries(DEFAULT_PARAMS).map(([key, defaultValue]) => {
    const range = (NUMBER_RULES as Record<string, readonly [number, number, number]>)[key];
    const choices = (ENUM_RULES as Record<string, readonly string[]>)[key];
    const shape = range
      ? { type: range[2] === 0 ? "integer" : "number", minimum: range[0], maximum: range[1], multipleOf: 10 ** -range[2] }
      : choices ? { type: "string", enum: [...choices] }
        : key === "colorCount" ? { type: "integer", enum: [2, 3, 4] }
          : key === "layoutCells" ? { type: "array", maxItems: 144, items: CELL_SCHEMA }
            : key === "cellAnimations" ? { type: "array", maxItems: 25000, items: CELL_ANIMATION_SCHEMA }
              : key === "keyframeTracks" ? KEYFRAME_TRACKS_SCHEMA
            : typeof defaultValue === "boolean" ? { type: "boolean" }
          : Array.isArray(defaultValue) ? { type: "array", minItems: 4, maxItems: 4, items: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } }
            : { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
    const description = PARAMETER_DESCRIPTIONS[key as keyof PatternParams];
    return [key, { ...shape, default: structuredClone(defaultValue), ...(description ? { description } : {}) }];
  })),
} as const;

const vectorFingerprints = new WeakMap<VectorMask, string>();

export function applyPreset(params: PatternParams, partial: Partial<PatternParams>): PatternParams {
  return structuredClone({ ...params, ...partial });
}

export function parsePreset(value: unknown): PatternParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Project settings must be an object.");
  }
  const candidate = value as { params?: unknown };
  const rawValue = Object.hasOwn(candidate, "params") ? candidate.params : candidate;
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    throw new Error("Project parameters must be an object.");
  }
  const raw = rawValue as Record<string, unknown>;
  const next = structuredClone(DEFAULT_PARAMS);
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(DEFAULT_PARAMS, key)) throw new Error(`Unknown pattern parameter “${key}”.`);
  }
  const target = next as unknown as Record<string, unknown>;
  for (const [key, [minimum, maximum, decimals]] of Object.entries(NUMBER_RULES)) {
    const field = raw[key];
    if (field === undefined) continue;
    if (typeof field !== "number" || !Number.isFinite(field) || field < minimum || field > maximum) {
      throw new Error(`Project field “${key}” is outside its supported range.`);
    }
    target[key] = decimals === 0 ? Math.round(field) : Number(field.toFixed(decimals));
  }
  for (const [key, allowed] of Object.entries(ENUM_RULES)) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "string" || !(allowed as readonly string[]).includes(raw[key])) {
      throw new Error(`Project field “${key}” is invalid.`);
    }
    target[key] = raw[key];
  }
  for (const key of ["useCells", "invert", "transparent", "keyframeLoop"] as const) {
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
  for (const key of ["monoColor", "backgroundColor", "gradientStart", "gradientEnd"] as const) {
    if (raw[key] !== undefined) {
      if (!isHex(raw[key])) throw new Error(`Project field “${key}” must be a six-digit hex color.`);
      next[key] = raw[key].toLowerCase();
    }
  }
  if (raw.colors !== undefined) {
    if (!Array.isArray(raw.colors) || raw.colors.length !== 4 || Array.from(raw.colors).some((color) => !isHex(color))) {
      throw new Error("Project colors must contain four six-digit hex colors.");
    }
    next.colors = raw.colors.map((color) => (color as string).toLowerCase()) as PatternParams["colors"];
  }
  if (raw.layoutCells !== undefined) {
    if (!Array.isArray(raw.layoutCells) || raw.layoutCells.length > 144) throw new Error("Layout cells must be an array of at most 144 overrides.");
    const indices = new Set<number>();
    next.layoutCells = Array.from(raw.layoutCells, (entry): LayoutCellOverride => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Each layout cell must be an object.");
      const cell = entry as Record<string, unknown>;
      if (typeof cell.index !== "number" || !Number.isInteger(cell.index)) throw new Error("Each layout cell needs an integer index.");
      const result: LayoutCellOverride = { index: cell.index };
      for (const key of Object.keys(cell)) {
        if (key !== "maskShape" && !Object.hasOwn(CELL_NUMBER_RULES, key)) throw new Error(`Unknown layout cell parameter “${key}”.`);
      }
      for (const [key, [min, max, decimals]] of Object.entries(CELL_NUMBER_RULES)) {
        const value = cell[key];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Layout cell field “${key}” is outside its supported range.`);
        (result as unknown as Record<string, unknown>)[key] = Number(value.toFixed(decimals));
      }
      if (cell.maskShape !== undefined) {
        if (typeof cell.maskShape !== "string" || !(ENUM_RULES.maskShape as readonly string[]).includes(cell.maskShape)) throw new Error("Layout cell mask shape is invalid.");
        result.maskShape = cell.maskShape as PatternParams["maskShape"];
      }
      if (indices.has(result.index)) throw new Error("Layout cell indices must be unique.");
      indices.add(result.index);
      return result;
    }).sort((first, second) => first.index - second.index);
  }
  if (raw.cellAnimations !== undefined) {
    if (!Array.isArray(raw.cellAnimations) || raw.cellAnimations.length > 25000) {
      throw new Error("Cell animations must be an array of at most 25,000 overrides.");
    }
    const ids = new Set<string>();
    next.cellAnimations = Array.from(raw.cellAnimations, (entry): CellAnimationOverride => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Each cell animation must be an object.");
      const cell = entry as Record<string, unknown>;
      if (typeof cell.id !== "string" || !ENTITY_ID.test(cell.id)) throw new Error("Cell animation ID must be cell:repeatIndex:row:column within the supported grid.");
      if (ids.has(cell.id)) throw new Error("Cell animation IDs must be unique.");
      ids.add(cell.id);
      for (const key of Object.keys(cell)) {
        if (key !== "id" && !(ANIMATION_NUMBERS as readonly string[]).includes(key) && !(ANIMATION_ENUMS as readonly string[]).includes(key)) {
          throw new Error(`Unknown cell animation parameter “${key}”.`);
        }
      }
      const result: CellAnimationOverride = { id: cell.id };
      for (const key of ANIMATION_NUMBERS) {
        const field = cell[key];
        if (field === undefined) continue;
        const [minimum, maximum, decimals] = NUMBER_RULES[key];
        if (typeof field !== "number" || !Number.isFinite(field) || field < minimum || field > maximum) {
          throw new Error(`Cell animation field “${key}” is outside its supported range.`);
        }
        result[key] = Number(field.toFixed(decimals));
      }
      for (const key of ANIMATION_ENUMS) {
        const field = cell[key];
        if (field === undefined) continue;
        if (typeof field !== "string" || !(ENUM_RULES[key] as readonly string[]).includes(field)) throw new Error(`Cell animation field “${key}” is invalid.`);
        (result as unknown as Record<string, unknown>)[key] = field;
      }
      return result;
    }).sort((first, second) => compareCellTargets(first.id, second.id));
  }
  if (raw.keyframeTracks !== undefined) next.keyframeTracks = parseKeyframeTracks(raw.keyframeTracks, next.keyframeDuration);
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

export function canonicalizePatternParams(params: PatternParams): PatternParams {
  return parsePreset(params);
}

export function projectFingerprint(params: PatternParams, source: SourceData): string {
  const canonical = canonicalizePatternParams(params);
  let vectorFingerprint = source.vectorMask ? vectorFingerprints.get(source.vectorMask) : undefined;
  if (source.vectorMask && !vectorFingerprint) {
    vectorFingerprint = fingerprintText(JSON.stringify(parseVectorMask(source.vectorMask)));
    vectorFingerprints.set(source.vectorMask, vectorFingerprint);
  }
  return fingerprintText(JSON.stringify([
    canonical,
    source.width,
    source.height,
    source.usesAlpha,
    source.fingerprint,
    vectorFingerprint ?? null,
  ]));
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
