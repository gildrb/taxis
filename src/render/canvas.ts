import { generatePattern } from "../model/pattern";
import type { PatternFrame, RenderInput } from "../model/types";

export function drawCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  input: RenderInput,
): PatternFrame {
  const frame = generatePattern(input);
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error("2D canvas is unavailable.");
  drawPatternFrame(context, frame);
  return frame;
}

export function drawPatternFrame(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: PatternFrame,
): void {
  context.clearRect(0, 0, frame.width, frame.height);
  context.imageSmoothingEnabled = false;
  if (frame.background) {
    context.globalAlpha = 1;
    context.fillStyle = frame.background;
    context.fillRect(0, 0, frame.width, frame.height);
  }
  for (const primitive of frame.primitives) {
    if (primitive.opacity <= 0) continue;
    context.globalAlpha = primitive.opacity;
    context.fillStyle = primitive.color;
    context.fillRect(primitive.x, primitive.y, primitive.width, primitive.height);
  }
  context.globalAlpha = 1;
}
