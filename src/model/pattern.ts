import { sampleSource } from "./source";
import { canonicalizePatternParams, projectFingerprint } from "./params";
import type {
  PatternFrame,
  PatternParams,
  PatternPrimitive,
  PatternProject,
  RenderInput,
  SourceSample,
} from "./types";

type UnitRect = readonly [x: number, y: number, width: number, height: number];

const BAR_PATTERNS: readonly (readonly UnitRect[])[] = [
  [[0, 28 / 64, 1, 8 / 64]],
  [[0, 20 / 64, 1, 24 / 64]],
  [[0, 12 / 64, 1, 40 / 64]],
  [[0, 4 / 64, 1, 56 / 64]],
  [[0, 12 / 64, 1, 40 / 64]],
  [[0, 20 / 64, 1, 24 / 64]],
];

const CANDLE_PATTERNS: readonly (readonly UnitRect[])[] = [
  [[7 / 16, 0, 2 / 16, 1]],
  [[5 / 16, 0, 6 / 16, 1]],
  [[3 / 16, 0, 10 / 16, 1]],
  [[1 / 16, 0, 14 / 16, 1]],
];

const SHAPE_PATTERNS: readonly (readonly UnitRect[])[] = [
  [[31.5 / 64, 31.5 / 64, 1 / 64, 1 / 64]],
  [[28 / 64, 28 / 64, 8 / 64, 8 / 64]],
  [[28 / 64, 16 / 64, 8 / 64, 32 / 64]],
  [[28 / 64, 16 / 64, 8 / 64, 32 / 64], [16 / 64, 28 / 64, 32 / 64, 8 / 64]],
  [[16 / 64, 16 / 64, 32 / 64, 32 / 64]],
  [[0, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
];

const MAX_CELLS = 250_000;
const MAX_PRIMITIVES = 25_000;

export function generatePattern(input: RenderInput): PatternFrame {
  const { params } = input;
  const patterns = params.preset === "bars"
    ? BAR_PATTERNS
    : params.preset === "candles"
      ? CANDLE_PATTERNS
      : SHAPE_PATTERNS;
  const columns = Math.ceil(params.width / params.cellSize);
  const rows = Math.ceil(params.height / params.cellSize);
  const cellCount = columns * rows;
  if (cellCount > MAX_CELLS) {
    throw new Error("This output has more than 250,000 cells. Increase Cell Size before rendering.");
  }
  const maximumPatternRects = Math.max(...patterns.map((pattern) => pattern.length));
  const maximumRectsPerCell = maximumPatternRects + (params.colorMode === "source" && params.sourceBackground > 0 ? 1 : 0);
  if (cellCount * maximumRectsPerCell > MAX_PRIMITIVES) {
    throw new Error("This output can create more than 25,000 shapes. Increase Cell Size before rendering.");
  }
  const primitives: PatternPrimitive[] = [];
  const background = params.transparent
    ? null
    : params.colorMode === "custom"
      ? params.backgroundColor
      : "#000000";

  for (let y = 0; y < params.height; y += params.cellSize) {
    const row = Math.floor(y / params.cellSize);
    const visibleHeight = Math.min(params.cellSize, params.height - y);
    const sourceShift = params.preset === "bars" ? staggerForRow(row) * params.rowShift : 0;
    for (let x = 0; x < params.width; x += params.cellSize) {
      const visibleWidth = Math.min(params.cellSize, params.width - x);
      const sample = sampleSource(input.source, x + visibleWidth / 2 - sourceShift, y + visibleHeight / 2, params);
      if (sample.alpha <= 0) continue;
      const value = adjustedValue(sample, params);
      const patternIndex = Math.min(patterns.length - 1, Math.floor(value * (patterns.length - 1)));
      const pattern = patterns[patternIndex] ?? patterns[0]!;
      const color = patternColor(sample, value, params);

      if (params.colorMode === "source" && params.sourceBackground > 0 && sample.alpha > 0) {
        primitives.push({
          x,
          y,
          width: params.cellSize,
          height: params.cellSize,
          color: rgb(sample.red, sample.green, sample.blue),
          opacity: params.sourceBackground * sample.alpha,
        });
      }

      for (const [unitX, unitY, unitWidth, unitHeight] of pattern) {
        primitives.push({
          x: x + unitX * params.cellSize,
          y: y + unitY * params.cellSize,
          width: unitWidth * params.cellSize,
          height: unitHeight * params.cellSize,
          color,
          opacity: params.colorMode === "source" ? sample.alpha : 1,
        });
      }
    }
  }

  return {
    width: params.width,
    height: params.height,
    background,
    primitives,
  };
}

export function patternToSvg(input: RenderInput): string {
  const frame = generatePattern(input);
  const project = projectFor(input);
  const metadata = escapeXml(JSON.stringify({
    ...project,
    source: {
      name: project.source.name,
      fingerprint: project.source.fingerprint,
      usesAlpha: project.source.usesAlpha,
      ...(project.source.kind ? { kind: project.source.kind, size: project.source.size } : {}),
    },
  }));
  const background = frame.background
    ? `  <rect width="${frame.width}" height="${frame.height}" fill="${frame.background}"/>\n`
    : "";
  const shapeElements: string[] = [];
  for (const shape of frame.primitives) {
    if (shape.opacity <= 0 || shape.width <= 0 || shape.height <= 0) continue;
    shapeElements.push(`  <rect x="${format(shape.x)}" y="${format(shape.y)}" width="${format(shape.width)}" height="${format(shape.height)}" fill="${shape.color}"${shape.opacity < 1 ? ` opacity="${format(shape.opacity)}"` : ""}/>`);
  }
  const shapes = shapeElements.join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frame.width} ${frame.height}" width="${frame.width}" height="${frame.height}">\n  <metadata>${metadata}</metadata>\n${background}${shapes}\n</svg>\n`;
}

export function projectFor(input: RenderInput): PatternProject {
  const { params, source } = input;
  const canonicalParams = canonicalizePatternParams(params);
  return {
    app: "Pattern Lab",
    version: 2,
    fingerprint: projectFingerprint(canonicalParams, source),
    params: canonicalParams,
    source: {
      name: source.name,
      fingerprint: source.fingerprint,
      usesAlpha: source.usesAlpha,
      ...(source.dataUrl ? { dataUrl: source.dataUrl } : {}),
      ...(source.kind ? { kind: source.kind, size: source.width } : {}),
    },
  };
}

export function adjustedValue(sample: SourceSample, params: PatternParams): number {
  if (sample.alpha <= 0) return 0;
  const initial = params.invert ? 1 - sample.value : sample.value;
  return clamp01((initial - 0.5) * params.contrast + 0.5 + params.luminanceBias * 0.35);
}

function patternColor(sample: SourceSample, value: number, params: PatternParams): string {
  if (params.colorMode === "source") return rgb(sample.red, sample.green, sample.blue);
  if (params.colorMode === "monochrome") {
    const [red, green, blue] = hexToRgb(params.monoColor);
    return rgb(red * value, green * value, blue * value);
  }
  const index = Math.min(params.colorCount - 1, Math.floor(value * params.colorCount));
  return params.colors[index] ?? params.colors[0];
}

function staggerForRow(row: number): number {
  const offsets = [0, -0.58, 0.34, -0.22, 0.72, -0.4, 0.16] as const;
  return offsets[row % offsets.length] ?? 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function rgb(red: number, green: number, blue: number): string {
  return `rgb(${Math.round(clamp01(red) * 255)} ${Math.round(clamp01(green) * 255)} ${Math.round(clamp01(blue) * 255)})`;
}

function format(value: number): string {
  return Number(value.toFixed(12)).toString();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
