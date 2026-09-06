import { BufferTarget, canEncodeVideo, Mp4OutputFormat, Output, VideoSample, VideoSampleSource, WebMOutputFormat, type VideoCodec } from "mediabunny";
import type { RenderInput } from "../model/types";
import type { SvgRenderer } from "../render/native";
import { renderScene } from "../render/scene";

export type ExportFormat = "svg" | "png" | "jpeg" | "webp" | "mp4" | "webm";
export interface ExportOptions {
  format: ExportFormat;
  /** Video duration in seconds. Must contain an integral number of frames. */
  duration?: number;
  fps?: number;
  quality?: number;
  /** Opaque #RRGGBB background for JPEG and video. Defaults to the scene background. */
  background?: string;
  signal?: AbortSignal;
  onProgress?: (progress: { completed: number; total: number }) => void;
}
export interface ExportSupport { supported: boolean; reason?: string; codec?: VideoCodec }
const MAX_PIXELS = 16_777_216;
const MAX_RASTER_PIXELS = 4_194_304;
const MAX_FRAMES = 1_800;
const MAX_BYTES = 128 * 1024 * 1024;
const MIME = { svg: "image/svg+xml", png: "image/png", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", webm: "video/webm" } as const;

function validateSize(width: number, height: number, raster = false): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > (raster ? MAX_RASTER_PIXELS : MAX_PIXELS)) {
    throw new Error(raster ? "Raster export dimensions must be positive integers with at most 4,194,304 pixels. Reduce the canvas size." : "Export dimensions must be positive integers with at most 16,777,216 pixels.");
  }
}

/** Validates rather than silently rounding duration or resizing the user's scene. */
export function videoFrameCount(duration: number, fps: number): number {
  const count = duration * fps;
  if (!Number.isInteger(fps) || fps < 1 || fps > 60 || !Number.isFinite(duration) || duration <= 0 || duration > 60 || Math.abs(count - Math.round(count)) > 1e-7 || count < 1 || count > MAX_FRAMES) {
    throw new Error("Choose 1–60 fps and up to 60 seconds (at most 1,800 frames). Duration × fps must be a whole number.");
  }
  return Math.round(count);
}

async function videoCodec(format: "mp4" | "webm", width: number, height: number): Promise<VideoCodec | null> {
  if (typeof isSecureContext !== "undefined" && !isSecureContext) throw new Error("Video export requires HTTPS or localhost. Open Taxis over HTTPS.");
  if (typeof VideoEncoder === "undefined") return null;
  // VP9 is valid inside MP4 and works in Chromium builds without licensed AVC encoding.
  for (const codec of (format === "mp4" ? ["avc", "vp9"] : ["vp9", "vp8"]) as VideoCodec[]) {
    if (await canEncodeVideo(codec, { width, height, bitrate: 4_000_000, latencyMode: "quality" })) return codec;
  }
  return null;
}

export async function getExportSupport(width: number, height: number, fps = 30): Promise<Record<ExportFormat, ExportSupport>> {
  const supported = { supported: true };
  const result: Record<ExportFormat, ExportSupport> = { svg: supported, png: supported, jpeg: supported, webp: supported, mp4: supported, webm: supported };
  try { validateSize(width, height); } catch (error) {
    return Object.fromEntries(Object.keys(result).map(format => [format, { supported: false, reason: (error as Error).message }])) as typeof result;
  }
  try { validateSize(width, height, true); } catch (error) {
    for (const format of ["png", "jpeg", "webp", "mp4", "webm"] as const) result[format] = { supported: false, reason: (error as Error).message };
    return result;
  }
  for (const format of ["jpeg", "webp"] as const) {
    try {
      const canvas = new OffscreenCanvas(1, 1);
      if (!canvas.getContext("2d")) throw new Error("Missing canvas context");
      const blob = await canvas.convertToBlob({ type: MIME[format] });
      if (blob.type !== MIME[format]) throw new Error("Missing codec");
    } catch { result[format] = { supported: false, reason: `This browser cannot encode ${format.toUpperCase()}. Use PNG or a current Chromium browser.` }; }
  }
  for (const format of ["mp4", "webm"] as const) {
    try {
      validateSize(width, height, true);
      videoFrameCount(1, fps);
      const codec = await videoCodec(format, width, height);
      if (!codec) throw new Error(`No ${format.toUpperCase()} video encoder is available at this size. Try a smaller canvas, WebM, or current Chrome on HTTPS/localhost.`);
      result[format] = { supported: true, codec, ...(format === "mp4" && codec === "vp9" ? { reason: "MP4 uses VP9 on this browser. Some older video players require H.264; use current Chrome or VLC to play it." } : {}) };
    } catch (error) { result[format] = { supported: false, reason: (error as Error).message }; }
  }
  return result;
}

/** Composites copied native RGBA, not vector geometry. */
export function compositeBackground(pixels: Uint8ClampedArray, background: string): void {
  if (!/^#[0-9a-f]{6}$/i.test(background)) throw new Error("Export background must be an opaque #RRGGBB color.");
  const rgb = [1, 3, 5].map(index => parseInt(background.slice(index, index + 2), 16));
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]! / 255;
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(pixels[i + c]! * alpha + rgb[c]! * (1 - alpha));
    pixels[i + 3] = 255;
  }
}

/** Captures params, source pixels, vector masks and time before the first asynchronous boundary. */
export async function exportScene(input: RenderInput, renderer: SvgRenderer, options: ExportOptions): Promise<Blob> {
  const scene = structuredClone(input);
  const { format, signal, onProgress, fps = 30, duration = 3, quality = 0.92, background = scene.params.backgroundColor } = options;
  if (!(format in MIME)) throw new Error("Unknown export format.");
  signal?.throwIfAborted();
  const { width, height } = scene.params;
  const video = format === "mp4" || format === "webm";
  validateSize(width, height, format !== "svg");
  if (!Number.isFinite(scene.time ?? 0)) throw new Error("Export time must be finite.");
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) throw new Error("Quality must be between 0 and 1.");
  const total = video ? videoFrameCount(duration, fps) : 1;
  onProgress?.({ completed: 0, total });
  // Yield a task, not a microtask, so the browser can paint progress and deliver cancellation.
  await new Promise(resolve => setTimeout(resolve, 0));
  signal?.throwIfAborted();
  if (format === "svg" || format === "png") {
    const blob = new Blob([renderScene(scene, renderer, format)], { type: MIME[format] });
    signal?.throwIfAborted();
    onProgress?.({ completed: 1, total });
    return blob;
  }
  if (!video) {
    const raster = renderScene(scene, renderer, "rgba");
    if (format === "jpeg") compositeBackground(raster.pixels, background);
    const canvas = new OffscreenCanvas(width, height);
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Browser image encoding is unavailable. Use PNG instead.");
      context.putImageData(new ImageData(raster.pixels, width, height), 0, 0);
      const blob = await canvas.convertToBlob({ type: MIME[format], quality });
      signal?.throwIfAborted();
      if (blob.type !== MIME[format]) throw new Error(`This browser cannot encode ${format.toUpperCase()}. Use PNG instead.`);
      onProgress?.({ completed: 1, total });
      return blob;
    } finally { canvas.width = canvas.height = 1; }
  }
  const codec = await videoCodec(format, width, height);
  signal?.throwIfAborted();
  if (!codec) throw new Error(`No ${format.toUpperCase()} encoder is available at this size. Try a smaller canvas, WebM, or current Chrome on HTTPS/localhost.`);
  const target = new BufferTarget();
  target.on("write", ({ end }) => { if (end > MAX_BYTES) throw new Error("Video exceeds 128 MiB. Reduce duration or dimensions."); });
  let encodedBytes = 0;
  const source = new VideoSampleSource({ codec, bitrate: 4_000_000, latencyMode: "quality", keyFrameInterval: 2,
    onEncodedPacket(packet) { encodedBytes += packet.byteLength; if (encodedBytes > MAX_BYTES) throw new Error("Video exceeds 128 MiB. Reduce duration or dimensions."); },
  });
  const output = new Output({ target, format: format === "mp4" ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat() });
  output.addVideoTrack(source, { frameRate: fps });
  output.setMetadataTags({ title: "Taxis" });
  let cancellation: Promise<void> | undefined;
  const abort = () => { cancellation ??= output.cancel(); void cancellation.catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await output.start();
    for (let index = 0; index < total; index++) {
      signal?.throwIfAborted();
      const raster = renderScene({ ...scene, time: (scene.time ?? 0) + index / fps }, renderer, "rgba");
      compositeBackground(raster.pixels, background);
      const sample = new VideoSample(raster.pixels, { format: "RGBA", codedWidth: width, codedHeight: height, timestamp: index / fps, duration: 1 / fps });
      try { await source.add(sample); } finally { sample.close(); }
      signal?.throwIfAborted();
      onProgress?.({ completed: index + 1, total });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal?.throwIfAborted();
    await output.finalize();
    signal?.throwIfAborted();
    if (!target.buffer) throw new Error("The video encoder produced no output.");
    return new Blob([target.buffer], { type: MIME[format] });
  } catch (error) {
    await (cancellation ?? output.cancel());
    signal?.throwIfAborted();
    throw error;
  } finally { signal?.removeEventListener("abort", abort); }
}
