import { patternToSvg } from "../model/pattern";
import type { RenderInput } from "../model/types";
import type { SvgRaster, SvgRenderer } from "./native";

export function renderScene(input: RenderInput, renderer: SvgRenderer, format: "rgba"): SvgRaster;
export function renderScene(input: RenderInput, renderer: SvgRenderer, format: "svg" | "png"): Uint8Array<ArrayBuffer>;
export function renderScene(input: RenderInput, renderer: SvgRenderer, format: "rgba" | "svg" | "png"): SvgRaster | Uint8Array<ArrayBuffer> {
  const document = renderer.createDocument(patternToSvg(input));
  try {
    if (format === "svg") return document.serialize();
    return format === "png"
      ? document.png(input.params.width, input.params.height)
      : document.render(input.params.width, input.params.height);
  } finally {
    document.dispose();
  }
}
