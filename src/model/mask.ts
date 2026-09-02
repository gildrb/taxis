import type { MaskData } from "./types";

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

export async function fileToMask(file: File, size = 192): Promise<MaskData> {
  if (!isAcceptedImage(file)) {
    throw new Error("Use a PNG, JPEG, WebP, AVIF, or SVG file.");
  }
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return bitmapToMask(bitmap, file.name, size);
    } finally {
      bitmap.close();
    }
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return bitmapToMask(image, file.name, size);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export function bitmapToMask(
  source: CanvasImageSource,
  name: string,
  size = 192,
): MaskData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");

  context.clearRect(0, 0, size, size);
  const dimensions = sourceDimensions(source);
  const scale = Math.min(size / dimensions.width, size / dimensions.height);
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;
  context.drawImage(source, (size - width) / 2, (size - height) / 2, width, height);

  const pixels = context.getImageData(0, 0, size, size).data;
  let transparent = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if ((pixels[index] ?? 255) < 250) transparent++;
  }
  const usesAlpha = transparent > pixels.length / 4 / 100;
  const values = new Float32Array(size * size);
  for (let index = 0; index < values.length; index++) {
    const offset = index * 4;
    const alpha = (pixels[offset + 3] ?? 255) / 255;
    const luminance =
      ((pixels[offset] ?? 0) * 0.2126 +
        (pixels[offset + 1] ?? 0) * 0.7152 +
        (pixels[offset + 2] ?? 0) * 0.0722) /
      255;
    values[index] = usesAlpha ? alpha : luminance;
  }
  return { width: size, height: size, values, usesAlpha, name };
}

export function createRadialMask(size = 192): MaskData {
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const distance = Math.hypot(dx, dy);
      values[y * size + x] = Math.max(0, Math.min(1, (0.48 - distance) * 18));
    }
  }
  return { width: size, height: size, values, usesAlpha: true, name: "Generated orb" };
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
