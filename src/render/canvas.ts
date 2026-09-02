import { generateGeometry } from "../model/geometry";
import type { RenderInput } from "../model/types";

export interface CanvasRenderOptions {
  background?: string | null;
  size?: number;
}

export function drawCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  input: RenderInput,
  options: CanvasRenderOptions = {},
): void {
  const size = options.size ?? (canvas instanceof HTMLCanvasElement ? previewSize(canvas) : canvas.width);
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error("2D canvas is unavailable.");
  context.clearRect(0, 0, size, size);
  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, size, size);
  }
  const scale = size / 512;
  context.save();
  context.scale(scale, scale);
  for (const shape of generateGeometry(input)) {
    context.globalAlpha = shape.opacity;
    context.fillStyle = shape.color;
    context.beginPath();
    if (shape.kind === "circle") {
      context.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
    } else {
      context.roundRect(shape.x, shape.y, shape.width, shape.height, shape.radius);
    }
    context.fill();
  }
  context.restore();
  context.globalAlpha = 1;
}

function previewSize(canvas: HTMLCanvasElement): number {
  const bounds = canvas.getBoundingClientRect();
  return Math.max(320, Math.min(1400, Math.round(Math.min(bounds.width, bounds.height) * devicePixelRatio)));
}
