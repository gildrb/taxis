import { drawCanvas } from "../render/canvas";
import type { RenderInput } from "../model/types";

export async function recordWebM(
  readInput: () => RenderInput,
  onProgress: (progress: number) => void,
): Promise<Blob> {
  const input = readInput();
  const snapshot: RenderInput = { ...input, pointer: [0, 0], audio: 0 };
  const size = Math.min(input.params.resolution, 1080);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const stream = canvas.captureStream(input.params.fps);
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (!mimeType) throw new Error("This browser cannot encode WebM.");
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const complete = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("WebM recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  recorder.start();
  const start = performance.now();
  const durationMs = input.params.duration * 1_000;
  await new Promise<void>((resolve) => {
    const render = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / durationMs);
      drawCanvas(canvas, { ...snapshot, time: progress }, { size, background: "#0f1110" });
      onProgress(progress);
      if (progress < 1) requestAnimationFrame(render);
      else resolve();
    };
    requestAnimationFrame(render);
  });
  recorder.stop();
  for (const track of stream.getTracks()) track.stop();
  return complete;
}

export async function encodeMp4(
  readInput: () => RenderInput,
  onProgress: (progress: number) => void,
): Promise<Blob> {
  if (!("VideoEncoder" in window)) {
    throw new Error("MP4 export needs a browser with WebCodecs support.");
  }
  const [{ Muxer, ArrayBufferTarget }] = await Promise.all([import("mp4-muxer")]);
  const input = readInput();
  const snapshot: RenderInput = { ...input, pointer: [0, 0], audio: 0 };
  const size = Math.min(input.params.resolution, 1080);
  const fps = input.params.fps;
  const frameCount = Math.round(input.params.duration * fps);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const codecOptions = [
    { codec: "avc1.42001f", muxer: "avc" as const },
    { codec: "vp09.00.10.08", muxer: "vp9" as const },
    { codec: "av01.0.04M.08", muxer: "av1" as const },
  ];
  let selected: (typeof codecOptions)[number] | undefined;
  for (const candidate of codecOptions) {
    const support = await VideoEncoder.isConfigSupported({ codec: candidate.codec, width: size, height: size, framerate: fps, bitrate: 8_000_000 });
    if (support.supported) {
      selected = candidate;
      break;
    }
  }
  if (!selected) throw new Error("This browser has no MP4-compatible video encoder.");
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: selected.muxer, width: size, height: size, frameRate: fps },
    fastStart: "in-memory",
  });
  let failure: Error | undefined;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      failure = error;
    },
  });
  encoder.configure({
    codec: selected.codec,
    width: size,
    height: size,
    bitrate: 8_000_000,
    framerate: fps,
  });
  for (let frame = 0; frame < frameCount; frame++) {
    const progress = frame / frameCount;
    drawCanvas(canvas, { ...snapshot, time: progress }, { size, background: "#0f1110" });
    const videoFrame = new VideoFrame(canvas, { timestamp: Math.round((frame * 1_000_000) / fps) });
    encoder.encode(videoFrame, { keyFrame: frame % fps === 0 });
    videoFrame.close();
    onProgress((frame + 1) / frameCount);
    if (frame % 12 === 0) await new Promise(requestAnimationFrame);
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  return new Blob([target.buffer], { type: "video/mp4" });
}
