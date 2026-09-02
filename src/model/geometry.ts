import type { MaskData, OrbParams, OrbPrimitive, RenderInput } from "./types";

const SIZE = 512;
const TAU = Math.PI * 2;

function randomAt(seed: number, x: number, y: number): number {
  const value = Math.sin(seed * 91.73 + x * 12.9898 + y * 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function sampleMask(mask: MaskData, x: number, y: number, params: OrbParams): number {
  const cropX = (x - 0.5) / params.crop + 0.5;
  const cropY = (y - 0.5) / params.crop + 0.5;
  if (cropX < 0 || cropX > 1 || cropY < 0 || cropY > 1) return 0;
  const px = Math.min(mask.width - 1, Math.max(0, Math.round(cropX * (mask.width - 1))));
  const py = Math.min(mask.height - 1, Math.max(0, Math.round(cropY * (mask.height - 1))));
  const sampled = mask.values[py * mask.width + px] ?? 0;
  const value = params.inversion ? 1 - sampled : sampled;
  return Math.max(0, Math.min(1, (value - 0.5) * params.contrast + 0.5));
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function mixColor(a: string, b: string, amount: number): string {
  const start = hexToRgb(a);
  const end = hexToRgb(b);
  const channels = start.map((value, index) =>
    Math.round(value + ((end[index] ?? value) - value) * amount),
  );
  return `rgb(${channels.join(" ")})`;
}

function transformPoint(
  x: number,
  y: number,
  input: RenderInput,
  noiseX: number,
  noiseY: number,
): [number, number] {
  const { params, time, pointer, audio } = input;
  const localY = y * 2 - 1;
  const taper = 1 - params.taper * Math.pow(Math.abs(localY), 1.7) * 0.42;
  let localX = (x * 2 - 1) * taper;
  localX += params.curvature * (1 - localY * localY) * 0.22;
  localX += params.wave * Math.sin(TAU * (localY * 0.72 + time + params.phase));
  localX += noiseX * params.noise * 0.075;
  let nextY = localY + noiseY * params.noise * 0.035;
  const pulse = 1 + params.breathing * Math.sin(TAU * (time + params.phase)) + audio * params.audio * 0.08;
  localX *= pulse;
  nextY *= pulse;
  localX += pointer[0] * params.pointer * (0.08 + 0.04 * localY);
  nextY += pointer[1] * params.pointer * 0.08;
  const angle = (params.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    SIZE / 2 + (localX * cos - nextY * sin) * SIZE * 0.42,
    SIZE / 2 + (localX * sin + nextY * cos) * SIZE * 0.42,
  ];
}

export function generateGeometry(input: RenderInput): OrbPrimitive[] {
  const { params, mask } = input;
  const primitives: OrbPrimitive[] = [];
  const rows = Math.max(4, Math.round(params.slices));
  const columns = Math.max(8, Math.round(params.dots));
  const rowStep = 1 / rows;

  for (let row = 0; row < rows; row++) {
    const y = (row + 0.5) * rowStep;
    const drawDots = params.mode === "dots" || (params.mode === "hybrid" && row % 3 !== 0);
    const color = mixColor(params.palette[0], params.palette[1], y);
    const noiseY = randomAt(params.seed, row, 19) * 2 - 1;

    if (drawDots) {
      for (let column = 0; column < columns; column++) {
        const x = (column + 0.5) / columns;
        const value = sampleMask(mask, x, y, params);
        if (value < params.threshold) continue;
        const noiseX = randomAt(params.seed, column, row) * 2 - 1;
        const [px, py] = transformPoint(x, y, input, noiseX, noiseY);
        const base = (SIZE * 0.78) / Math.max(rows, columns);
        const radius = base * params.thickness * (0.24 + value * 0.76) * (1 - params.spacing * 0.38);
        primitives.push({ kind: "circle", x: px, y: py, radius, color, opacity: 0.42 + value * 0.58 });
      }
      continue;
    }

    const samples = Math.max(72, columns * 2);
    let start = -1;
    let accumulated = 0;
    for (let column = 0; column <= samples; column++) {
      const x = column / samples;
      const value = column < samples ? sampleMask(mask, x, y, params) : 0;
      if (value >= params.threshold) {
        if (start < 0) start = column;
        accumulated += value;
      } else if (start >= 0) {
        const end = column;
        const center = (start + end) / 2 / samples;
        const average = accumulated / (end - start);
        const noiseX = randomAt(params.seed, row, start) * 2 - 1;
        const [px, py] = transformPoint(center, y, input, noiseX, noiseY);
        const transformedStart = transformPoint(start / samples, y, input, noiseX, noiseY)[0];
        const transformedEnd = transformPoint(end / samples, y, input, noiseX, noiseY)[0];
        const height = SIZE * rowStep * params.thickness * (1 - params.spacing * 0.55);
        const width = Math.max(height * 0.34, Math.abs(transformedEnd - transformedStart));
        primitives.push({
          kind: "rect",
          x: px - width / 2,
          y: py - height / 2,
          width,
          height,
          radius: height * (0.16 + Math.abs(params.curvature) * 0.42),
          color,
          opacity: 0.52 + average * 0.48,
        });
        start = -1;
        accumulated = 0;
      }
    }
  }
  return primitives;
}

export function geometryToSvg(input: RenderInput): string {
  const shapes = generateGeometry(input)
    .map((shape) => {
      if (shape.kind === "circle") {
        return `  <circle cx="${shape.x.toFixed(2)}" cy="${shape.y.toFixed(2)}" r="${shape.radius.toFixed(2)}" fill="${shape.color}" opacity="${shape.opacity.toFixed(3)}"/>`;
      }
      return `  <rect x="${shape.x.toFixed(2)}" y="${shape.y.toFixed(2)}" width="${shape.width.toFixed(2)}" height="${shape.height.toFixed(2)}" rx="${shape.radius.toFixed(2)}" fill="${shape.color}" opacity="${shape.opacity.toFixed(3)}"/>`;
    })
    .join("\n");
  const metadata = JSON.stringify({ generator: "Orb Lab", params: input.params });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">\n  <metadata>${escapeXml(metadata)}</metadata>\n${shapes}\n</svg>\n`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
