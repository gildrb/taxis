import type { PatternParams, SourceData, SourceSample } from "./types";

const MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);

export function isAcceptedImage(file: File): boolean {
  return MIME_TYPES.has(file.type) || /\.(png|jpe?g|webp|avif|svg)$/i.test(file.name);
}

export async function fileToSource(file: File, maxDimension = 1600): Promise<SourceData> {
  if (!isAcceptedImage(file)) {
    throw new Error("Use a PNG, JPEG, WebP, AVIF, or SVG file.");
  }
  const dataUrl = await readAsDataUrl(file);
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return bitmapToSource(bitmap, file.name, maxDimension, dataUrl);
    } finally {
      bitmap.close();
    }
  } catch {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    return bitmapToSource(image, file.name, maxDimension, dataUrl);
  }
}

export async function dataUrlToSource(dataUrl: string, name: string): Promise<SourceData> {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("The project source image could not be restored.");
  const blob = await response.blob();
  return fileToSource(new File([blob], name, { type: blob.type }));
}

export function bitmapToSource(
  source: CanvasImageSource,
  name: string,
  maxDimension = 1600,
  dataUrl?: string,
): SourceData {
  const dimensions = sourceDimensions(source);
  if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error("The source image has no usable dimensions.");
  }
  const scale = Math.min(1, maxDimension / Math.max(dimensions.width, dimensions.height));
  const width = Math.max(1, Math.round(dimensions.width * scale));
  const height = Math.max(1, Math.round(dimensions.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  let transparent = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if ((pixels[index] ?? 255) < 250) transparent++;
  }
  // Small antialiased or rounded-corner transparency must not erase interior luminance detail.
  // Alpha is the automatic signal only when transparency is a meaningful part of the artwork.
  const usesAlpha = transparent > width * height * 0.1;
  return {
    width,
    height,
    pixels,
    usesAlpha,
    name,
    fingerprint: fingerprintPixels(width, height, pixels),
    ...(dataUrl ? { dataUrl: canvas.toDataURL("image/png") } : {}),
  };
}

export function createRadialSource(size = 512): SourceData {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const distance = Math.hypot(dx, dy);
      const value = Math.round(clamp01((0.365 - distance) * size * 0.65 + 0.5) * 255);
      const offset = (y * size + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  return {
    width: size,
    height: size,
    pixels,
    usesAlpha: false,
    name: "Generated sphere",
    kind: "radial",
    fingerprint: fingerprintPixels(size, size, pixels),
  };
}

export function sampleSource(
  source: SourceData,
  outputX: number,
  outputY: number,
  params: PatternParams,
): SourceSample {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  let drawWidth = params.width * params.scale;
  let drawHeight = params.height * params.scale;
  if (params.fit !== "stretch") {
    const fitScale = params.fit === "cover"
      ? Math.max(params.width / sourceWidth, params.height / sourceHeight)
      : Math.min(params.width / sourceWidth, params.height / sourceHeight);
    drawWidth = sourceWidth * fitScale * params.scale;
    drawHeight = sourceHeight * fitScale * params.scale;
  }
  const left = (params.width - drawWidth) / 2 + params.offsetX * params.width * 0.5;
  const top = (params.height - drawHeight) / 2 + params.offsetY * params.height * 0.5;
  const u = (outputX - left) / drawWidth;
  const v = (outputY - top) / drawHeight;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) {
    return { red: 0, green: 0, blue: 0, alpha: 0, value: 0 };
  }
  const x = Math.min(sourceWidth - 1, Math.max(0, Math.floor(u * sourceWidth)));
  const y = Math.min(sourceHeight - 1, Math.max(0, Math.floor(v * sourceHeight)));
  const offset = (y * sourceWidth + x) * 4;
  const red = (source.pixels[offset] ?? 0) / 255;
  const green = (source.pixels[offset + 1] ?? 0) / 255;
  const blue = (source.pixels[offset + 2] ?? 0) / 255;
  const alpha = (source.pixels[offset + 3] ?? 255) / 255;
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const channel = params.sampleChannel === "auto"
    ? (source.usesAlpha ? "alpha" : "luminance")
    : params.sampleChannel;
  return { red, green, blue, alpha, value: channel === "alpha" ? alpha : luminance };
}

export function fingerprintPixels(width: number, height: number, pixels: Uint8ClampedArray): string {
  let hash = 2_166_136_261;
  hash = Math.imul(hash ^ width, 16_777_619);
  hash = Math.imul(hash ^ height, 16_777_619);
  for (let index = 0; index < pixels.length; index++) {
    hash = Math.imul(hash ^ (pixels[index] ?? 0), 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The source image could not be read."));
    reader.readAsDataURL(file);
  });
}

function sourceDimensions(source: CanvasImageSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (source instanceof SVGImageElement) {
    return { width: source.width.baseVal.value, height: source.height.baseVal.value };
  }
  if ("displayWidth" in source) {
    return { width: source.displayWidth, height: source.displayHeight };
  }
  return { width: source.width, height: source.height };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
