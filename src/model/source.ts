import type { SvgRenderer } from "../render/native";
import { fingerprintBytes } from "./fingerprint";
import { decodeSourcePng } from "./png-source";
import { multiplyMatrices, parseSvgMask, svgShapePath } from "./svg-mask";
import type { Matrix, PatternParams, SourceData, SourceSample, VectorMask } from "./types";

export { parseVectorMask } from "./svg-mask";

const maskErrors = new WeakMap<SourceData, string>();

const MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);

const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

function imageTypeForName(name: string): string | undefined {
  const extension = name.toLowerCase().match(/\.[^.]+$/)?.[0];
  return extension === ".png" ? "image/png"
    : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
      : extension === ".webp" ? "image/webp"
        : extension === ".avif" ? "image/avif"
          : extension === ".svg" ? "image/svg+xml"
            : undefined;
}

export function isAcceptedImage(file: File): boolean {
  return MIME_TYPES.has(file.type) || /\.(png|jpe?g|webp|avif|svg)$/i.test(file.name);
}

export async function fileToSource(file: File, renderer: SvgRenderer, maxDimension = 1600): Promise<SourceData> {
  if (!isAcceptedImage(file)) {
    throw new Error("Use a PNG, JPEG, WebP, AVIF, or SVG file.");
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Source images must be smaller than 50 MB.");
  if (!Number.isFinite(maxDimension) || maxDimension < 1) throw new Error("Maximum source size must be at least 1 pixel.");
  const canonicalType = imageTypeForName(file.name);
  const decodableFile = canonicalType && !MIME_TYPES.has(file.type)
    ? new File([file], file.name, { lastModified: file.lastModified, type: canonicalType })
    : file;
  if (decodableFile.type === "image/svg+xml") {
    const text = await decodableFile.text();
    const document = renderer.createDocument(text);
    try {
      const { width, height } = scaledSourceSize(document.size, maxDimension);
      const raster = document.render(width, height);
      const png = document.png(width, height);
      let binary = "";
      for (let offset = 0; offset < png.length; offset += 32_768) binary += String.fromCharCode(...png.subarray(offset, offset + 32_768));
      const source = pixelsToSource(width, height, raster.pixels, file.name, `data:image/png;base64,${btoa(binary)}`);
      try {
        if (typeof DOMParser === "undefined") throw new Error("Precise SVG mask extraction needs a browser XML parser. Use Sample mode for headless source imports.");
        source.vectorMask = parseSvgMask(text, document.size);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "The SVG contains unsupported geometry.";
        maskErrors.set(source, reason);
        console.warn(`SVG imported as a raster image. Precise mask unavailable: ${reason}`);
      }
      return source;
    } finally {
      document.dispose();
    }
  }
  try {
    const bitmap = await createImageBitmap(decodableFile);
    try {
      return bitmapToSource(bitmap, file.name, maxDimension, true);
    } finally {
      bitmap.close();
    }
  } catch {
    const url = URL.createObjectURL(decodableFile);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return bitmapToSource(image, file.name, maxDimension, true);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function dataUrlToSource(dataUrl: string, name: string, renderer: SvgRenderer): Promise<SourceData> {
  if (!dataUrl.startsWith("data:image/") || dataUrl.length > 64 * 1024 * 1024) throw new Error("The project source must be an image data URL smaller than 64 MB.");
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("The project source image could not be restored.");
  const blob = await response.blob();
  if (blob.size > MAX_SOURCE_BYTES) throw new Error("Source images must be smaller than 50 MB.");
  if (blob.type.split(";")[0] === "image/png") {
    const { width, height, pixels } = await decodeSourcePng(new Uint8Array(await blob.arrayBuffer()));
    return pixelsToSource(width, height, pixels, name, dataUrl);
  }
  return fileToSource(new File([blob], name, { type: blob.type }), renderer);
}

export function bitmapToSource(
  source: CanvasImageSource,
  name: string,
  maxDimension = 1600,
  embed = false,
): SourceData {
  const { width, height } = scaledSourceSize(sourceDimensions(source), maxDimension);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable.");
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  return pixelsToSource(width, height, pixels, name, embed ? canvas.toDataURL("image/png") : undefined);
}

function scaledSourceSize(dimensions: { width: number; height: number }, maxDimension: number): { width: number; height: number } {
  if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error("The source image has no usable dimensions.");
  }
  if (!Number.isFinite(maxDimension) || maxDimension < 1) throw new Error("Maximum source size must be at least 1 pixel.");
  const scale = Math.min(1, maxDimension / Math.max(dimensions.width, dimensions.height));
  return { width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) };
}

/** Analyzes owned, straight RGBA bytes without a Canvas premultiplication round trip. */
export function pixelsToSource(width: number, height: number, pixels: Uint8ClampedArray, name: string, dataUrl?: string): SourceData {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || pixels.length !== width * height * 4) {
    throw new Error("Source pixels must match positive integer RGBA dimensions.");
  }
  let transparent = 0;
  let minimumAlpha = 255;
  let maximumAlpha = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    const alpha = pixels[index] ?? 255;
    if (alpha < 250) transparent++;
    minimumAlpha = Math.min(minimumAlpha, alpha);
    maximumAlpha = Math.max(maximumAlpha, alpha);
  }
  // Ignore uniform opacity and small antialiased corners. Auto alpha is useful only
  // when transparency both covers meaningful area and carries a varying signal.
  const usesAlpha = transparent > width * height * 0.1 && maximumAlpha - minimumAlpha >= 16;
  return {
    width,
    height,
    pixels,
    usesAlpha,
    name,
    fingerprint: fingerprintPixels(width, height, pixels),
    ...(dataUrl === undefined ? {} : { dataUrl }),
  };
}

export function createRadialSource(size = 512): SourceData {
  if (!Number.isInteger(size) || size < 1 || size > 4096) {
    throw new Error("Generated source size must be an integer from 1 to 4096 pixels.");
  }
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

function sourceLayout(params: PatternParams, source: SourceData): { drawWidth: number; drawHeight: number; left: number; top: number; cosine: number; sine: number } {
  let drawWidth = params.width * params.scale;
  let drawHeight = params.height * params.scale;
  if (params.fit !== "stretch") {
    const fitScale = params.fit === "cover"
      ? Math.max(params.width / source.width, params.height / source.height)
      : Math.min(params.width / source.width, params.height / source.height);
    drawWidth = source.width * fitScale * params.scale;
    drawHeight = source.height * fitScale * params.scale;
  }
  const angle = params.sourceRotation * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const cardinal = params.sourceRotation % 90 === 0;
  return {
    drawWidth,
    drawHeight,
    left: (params.width - drawWidth) / 2 + params.offsetX * params.width * 0.5,
    top: (params.height - drawHeight) / 2 + params.offsetY * params.height * 0.5,
    // Exact quarter turns keep opposite footprint edges on the same side of
    // the sampling boundary, rather than losing a corner to trig roundoff.
    cosine: cardinal ? Math.round(cosine) || 0 : cosine,
    sine: cardinal ? Math.round(sine) || 0 : sine,
  };
}

/** Maps decoded source pixel coordinates to output; rotation uses the placed source center. */
export function sourcePlacement(params: PatternParams, source: SourceData): Matrix {
  const { drawWidth, drawHeight, left, top, cosine, sine } = sourceLayout(params, source);
  if (cosine === 1 && sine === 0) return [drawWidth / source.width, 0, 0, drawHeight / source.height, left, top];
  return [
    cosine * drawWidth / source.width,
    sine * drawWidth / source.width,
    -sine * drawHeight / source.height,
    cosine * drawHeight / source.height,
    left + drawWidth / 2 - cosine * drawWidth / 2 + sine * drawHeight / 2,
    top + drawHeight / 2 - sine * drawWidth / 2 - cosine * drawHeight / 2,
  ];
}

/** Produces only normalized vector paths, never imported XML or raster approximations. */
export function maskForSource(source: SourceData, params: PatternParams): VectorMask {
  if (params.symmetry !== "none") {
    throw new Error("Precise source masks do not support sample symmetry. Set symmetry to None, or use Sample mode.");
  }
  const placement = sourcePlacement(params, source);
  if (source.kind === "radial") {
    return {
      viewBox: [0, 0, params.width, params.height],
      paths: [{
        d: svgShapePath("circle", { cx: String(source.width / 2), cy: String(source.height / 2), r: String(source.width * 0.365) }),
        transform: placement,
        fillRule: "nonzero",
      }],
    };
  }
  if (!source.vectorMask) {
    const reason = maskErrors.get(source);
    throw new Error(reason
      ? `Precise source mask unavailable: ${reason} Use Sample mode or import an SVG with standalone filled paths.`
      : "Precise masks need a generated sphere or a supported SVG with filled vector shapes. Use Sample mode for raster images, or import a supported SVG.");
  }
  const [x, y, width, height] = source.vectorMask.viewBox;
  const toPixels: Matrix = [source.width / width, 0, 0, source.height / height, -x * source.width / width, -y * source.height / height];
  const toOutput = multiplyMatrices(placement, toPixels);
  return {
    viewBox: [0, 0, params.width, params.height],
    paths: source.vectorMask.paths.map((path) => {
      const transform = multiplyMatrices(toOutput, path.transform);
      if (!transform.every(Number.isFinite)) throw new Error("SVG mask coordinates exceed the supported output range. Resize its viewBox and paths, or use Sample mode.");
      return { ...path, transform };
    }),
  };
}

interface UnitPolygon {
  vertices: [number, number][];
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

// There are only thirty possible regular polygons. Share their unit geometry
// across SVG generation and whole-cell inclusion without rebuilding paths.
const unitPolygons = new Map<number, UnitPolygon>();

function geometricShape(params: PatternParams): {
  centerX: number;
  centerY: number;
  scale: number;
  polygon?: UnitPolygon;
  cosine: number;
  sine: number;
} | undefined {
  if (params.maskShape === "none") return undefined;
  const { width, height, maskScale, maskRotation } = params;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Geometric masks require positive finite canvas dimensions.");
  }
  if (!Number.isFinite(maskScale) || maskScale < 0.1 || maskScale > 1) throw new Error("Mask scale must be between 0.1 and 1.");
  if (!Number.isFinite(maskRotation) || maskRotation < -180 || maskRotation > 180) throw new Error("Mask rotation must be between -180 and 180 degrees.");
  let polygon: UnitPolygon | undefined;
  if (params.maskShape !== "circle") {
    const sides = params.maskShape === "triangle" ? 3 : params.maskShape === "square" ? 4 : params.maskShape === "octagon" ? 8 : params.maskShape === "polygon" ? params.maskSides : 0;
    if (!Number.isInteger(sides) || sides < 3 || sides > 32) throw new Error("Geometric masks require a supported shape and 3 to 32 polygon sides.");
    polygon = unitPolygons.get(sides);
    if (!polygon) {
      const start = -Math.PI / 2 + (sides % 2 === 0 ? Math.PI / sides : 0);
      const vertices: [number, number][] = sides === 4 ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : Array.from({ length: sides }, (_, index) => {
        const angle = start + index * Math.PI * 2 / sides;
        return [Math.cos(angle), Math.sin(angle)];
      });
      const left = Math.min(...vertices.map(([x]) => x));
      const right = Math.max(...vertices.map(([x]) => x));
      const top = Math.min(...vertices.map(([, y]) => y));
      const bottom = Math.max(...vertices.map(([, y]) => y));
      polygon = { vertices, centerX: (left + right) / 2, centerY: (top + bottom) / 2, width: right - left, height: bottom - top };
      unitPolygons.set(sides, polygon);
    }
  }
  const angle = maskRotation * Math.PI / 180;
  const cardinal = maskRotation % 90 === 0;
  return {
    centerX: width / 2,
    centerY: height / 2,
    scale: Math.min(width / (polygon?.width ?? 2), height / (polygon?.height ?? 2)) * maskScale,
    polygon,
    cosine: cardinal ? Math.round(Math.cos(angle)) || 0 : Math.cos(angle),
    sine: cardinal ? Math.round(Math.sin(angle)) || 0 : Math.sin(angle),
  };
}

/** Fits a regular built-in shape, centers its bounds, then rotates about the canvas center. */
export function geometricMask(params: PatternParams): VectorMask | undefined {
  const shape = geometricShape(params);
  if (!shape) return undefined;
  const { centerX, centerY, scale, polygon, cosine, sine } = shape;
  const d = polygon
    ? svgShapePath("polygon", { points: polygon.vertices.map(([x, y]) => `${centerX + (x - polygon.centerX) * scale} ${centerY + (y - polygon.centerY) * scale}`).join(" ") })
    : svgShapePath("circle", { cx: String(centerX), cy: String(centerY), r: String(scale) });
  return {
    viewBox: [0, 0, params.width, params.height],
    paths: [{
      d,
      transform: [cosine, sine, sine ? -sine : 0, cosine, centerX - cosine * centerX + sine * centerY, centerY - sine * centerX - cosine * centerY],
      fillRule: "nonzero",
    }],
  };
}

/** Tests a whole cell's center against the same analytic built-in shape used by SVG. */
export function geometricMaskContains(params: PatternParams, outputX: number, outputY: number): boolean {
  const shape = geometricShape(params);
  if (!shape) return true;
  if (!Number.isFinite(outputX) || !Number.isFinite(outputY)) return false;
  const { centerX, centerY, scale, polygon, cosine, sine } = shape;
  const dx = outputX - centerX;
  const dy = outputY - centerY;
  const x = (cosine * dx + sine * dy) / scale + (polygon?.centerX ?? 0);
  const y = (-sine * dx + cosine * dy) / scale + (polygon?.centerY ?? 0);
  // The tolerance only absorbs floating-point error at an exact edge. It does
  // not trace pixels, soften the mask, or depend on a browser path API.
  if (!polygon) return Math.hypot(x, y) <= 1 + 1e-12;
  for (let index = 0; index < polygon.vertices.length; index++) {
    const [ax, ay] = polygon.vertices[index]!;
    const [bx, by] = polygon.vertices[(index + 1) % polygon.vertices.length]!;
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < -1e-12) return false;
  }
  return true;
}

function sourceCoordinates(source: SourceData, outputX: number, outputY: number, params: PatternParams): [number, number] {
  const { drawWidth, drawHeight, left, top, cosine, sine } = sourceLayout(params, source);
  // Mirror the left/top output half before placement so rotation and offsets do
  // not break the requested output symmetry.
  if (params.symmetry === "x" || params.symmetry === "both") outputX = Math.min(outputX, params.width - outputX);
  if (params.symmetry === "y" || params.symmetry === "both") outputY = Math.min(outputY, params.height - outputY);
  if (cosine !== 1 || sine !== 0) {
    const centerX = left + drawWidth / 2;
    const centerY = top + drawHeight / 2;
    const dx = outputX - centerX;
    const dy = outputY - centerY;
    outputX = centerX + cosine * dx + sine * dy;
    outputY = centerY - sine * dx + cosine * dy;
  }
  return [(outputX - left) / drawWidth, (outputY - top) / drawHeight];
}

/** Unadjusted center coverage for whole-cell selection, never a spatial clip. */
export function sourceCoverage(source: SourceData, outputX: number, outputY: number, params: PatternParams): number {
  if (source.kind !== "radial") return sampleSource(source, outputX, outputY, params).alpha;
  const [u, v] = sourceCoordinates(source, outputX, outputY, params);
  const dx = u - 0.5;
  const dy = (v - 0.5) * source.height / source.width;
  return Math.hypot(dx, dy) <= 0.365 + Number.EPSILON * 8 ? 1 : 0;
}

export function sampleSource(
  source: SourceData,
  outputX: number,
  outputY: number,
  params: PatternParams,
): SourceSample {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const [u, v] = sourceCoordinates(source, outputX, outputY, params);
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u > 1 || v > 1) {
    return { red: 0, green: 0, blue: 0, alpha: 0, value: 0 };
  }
  // Pixel centers are at n + 0.5. Clamp both footprint edges equally.
  const pixelX = Math.max(0, Math.min(sourceWidth - 1, u * sourceWidth - 0.5));
  const pixelY = Math.max(0, Math.min(sourceHeight - 1, v * sourceHeight - 0.5));
  const x = Math.floor(pixelX);
  const y = Math.floor(pixelY);
  const offset = (y * sourceWidth + x) * 4;
  const sampleChannel = (channel: number): number => {
    const fallback = channel === 3 ? 255 : 0;
    const first = source.pixels[offset + channel] ?? fallback;
    const right = Math.min(sourceWidth - 1, x + 1);
    const bottom = Math.min(sourceHeight - 1, y + 1);
    const second = source.pixels[(y * sourceWidth + right) * 4 + channel] ?? fallback;
    const third = source.pixels[(bottom * sourceWidth + x) * 4 + channel] ?? fallback;
    const fourth = source.pixels[(bottom * sourceWidth + right) * 4 + channel] ?? fallback;
    const tx = pixelX - x;
    const ty = pixelY - y;
    const upper = first + (second - first) * tx;
    const lower = third + (fourth - third) * tx;
    return (upper + (lower - upper) * ty) / 255;
  };
  const red = sampleChannel(0);
  const green = sampleChannel(1);
  const blue = sampleChannel(2);
  const alpha = sampleChannel(3);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const channel = params.sampleChannel === "auto"
    ? (source.usesAlpha ? "alpha" : "luminance")
    : params.sampleChannel;
  return { red, green, blue, alpha, value: channel === "alpha" ? alpha : luminance };
}

export function fingerprintPixels(width: number, height: number, pixels: Uint8ClampedArray): string {
  return fingerprintBytes(pixels, width, height);
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
