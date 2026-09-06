import type { RenderInput } from "../model/types";
import type { SvgRenderer } from "./native";
import { renderScene } from "./scene";

/** Canvas presents native RGBA pixels; all vector rendering is Kor/Archetypon. */
export function drawCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  input: RenderInput,
  renderer: SvgRenderer,
): void {
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error("2D canvas is unavailable.");
  const raster = renderScene(input, renderer, "rgba");
  const image = new ImageData(raster.pixels, raster.width, raster.height);
  // Keep the last successful frame intact if native parsing or rendering fails.
  if (canvas.width !== raster.width) canvas.width = raster.width;
  if (canvas.height !== raster.height) canvas.height = raster.height;
  context.putImageData(image, 0, 0);
}
