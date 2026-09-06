import { describe, expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { compositeBackground, exportScene, getExportSupport, videoFrameCount } from "../src/export/encode";
import { DEFAULT_PARAMS } from "../src/model/params";
import { createRadialSource } from "../src/model/source";
import { createSvgRenderer } from "../src/render/native";
import { renderScene } from "../src/render/scene";

const artifact = new URL("../public/renderer/kor.wasm", import.meta.url);

describe("export services", () => {
  test("validates exact fixed-timestep plans and bounds", () => {
    expect(videoFrameCount(2.5, 24)).toBe(60);
    for (const [duration, fps] of [[0, 30], [61, 1], [60, 60], [1, 61], [0.11, 30], [NaN, 30]]) {
      expect(() => videoFrameCount(duration!, fps!)).toThrow();
    }
  });
  test("reports the native supersampled raster budget separately from SVG", async () => {
    const support = await getExportSupport(2500, 2500);
    expect(support.svg.supported).toBe(true);
    for (const format of ["png", "jpeg", "webp", "mp4", "webm"] as const) expect(support[format]).toMatchObject({ supported: false, reason: expect.stringContaining("4,194,304") });
  });
  test("explains insecure HTTP video export without suggesting a smaller canvas", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
    Object.defineProperty(globalThis, "isSecureContext", { configurable: true, value: false });
    try {
      const support = await getExportSupport(1500, 1500);
      for (const format of ["mp4", "webm"] as const) expect(support[format]).toEqual({ supported: false, reason: "Video export requires HTTPS or localhost. Open Taxis over HTTPS." });
    } finally {
      if (previous) Object.defineProperty(globalThis, "isSecureContext", previous);
      else Reflect.deleteProperty(globalThis, "isSecureContext");
    }
  });
  test("composites JPEG transparency onto the explicit background", () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 128]);
    compositeBackground(pixels, "#0000ff");
    expect([...pixels]).toEqual([0, 0, 255, 255, 128, 0, 127, 255]);
    expect(() => compositeBackground(pixels, "transparent")).toThrow();
  });
  test("native still exports snapshot the paused scene before yielding and honor cancellation", async () => {
    const renderer = await createSvgRenderer(await Bun.file(artifact).arrayBuffer());
    const scene = { params: { ...structuredClone(DEFAULT_PARAMS), width: 64, height: 64, animation: "pulse" as const }, source: createRadialSource(32), time: 0.37 };
    const expected = renderScene(scene, renderer, "svg");
    const pending = exportScene(scene, renderer, { format: "svg" });
    scene.params.colors[0] = "#ff0000";
    scene.source.pixels.fill(0);
    scene.time = 3;
    expect(new Uint8Array(await (await pending).arrayBuffer())).toEqual(expected);
    const png = await exportScene(scene, renderer, { format: "png" });
    expect([...new Uint8Array(await png.arrayBuffer()).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const controller = new AbortController();
    const cancelled = exportScene(scene, renderer, { format: "png", signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  });

  test("Chromium encodes genuine MP4/WebM and browser images from native pixels", async () => {
    const root = new URL("../", import.meta.url).pathname;
    const build = await Bun.build({ entrypoints: ["export-browser-proof"], target: "browser", plugins: [{ name: "proof", setup(builder) {
      builder.onResolve({ filter: /^export-browser-proof$/ }, () => ({ path: "export-browser-proof", namespace: "proof" }));
      builder.onLoad({ filter: /.*/, namespace: "proof" }, () => ({ loader: "ts", resolveDir: root, contents: `
        import { exportScene, getExportSupport } from "./src/export/encode";
        import { DEFAULT_PARAMS } from "./src/model/params";
        import { createRadialSource } from "./src/model/source";
        import { createSvgRenderer } from "./src/render/native";
        import { renderScene } from "./src/render/scene";
        import { Input, ALL_FORMATS, BlobSource, EncodedPacketSink, CanvasSink } from "mediabunny";
        window.proof = async () => {
          const native = await createSvgRenderer(await (await fetch("/kor.wasm")).arrayBuffer());
          let created = 0, disposed = 0;
          const renderer = { createDocument(source) { created++; const doc = native.createDocument(source); return { ...doc, dispose() { disposed++; doc.dispose(); } }; } };
          const scene = { params: { ...DEFAULT_PARAMS, width: 128, height: 96, useCells: true, cellSize: 16, sourceMode: "ignore", animation: "pulse", animationAmount: 0.8, animationDuration: 1 }, source: createRadialSource(32), time: 0.125 };
          const support = await getExportSupport(128, 96, 12);
          const videos = {};
          for (const format of ["mp4", "webm"]) {
            if (!support[format].supported) throw new Error(support[format].reason);
            const progress = [];
            const mutable = structuredClone(scene);
            const pending = exportScene(mutable, renderer, { format, duration: 1, fps: 12, onProgress: p => progress.push(p.completed) });
            mutable.time = 91;
            mutable.params.colors.fill("#00ff00");
            mutable.source.pixels.fill(0);
            const blob = await pending;
            const header = [...new Uint8Array(await blob.slice(0, 12).arrayBuffer())];
            const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
            try {
              const track = await input.getPrimaryVideoTrack();
              const packets = [];
              for await (const packet of new EncodedPacketSink(track).packets()) packets.push({ timestamp: packet.timestamp, duration: packet.duration });
              const sink = new CanvasSink(track);
              const hashes = [];
              const errors = [];
              for (const timestamp of [0, 0.25, 0.5]) {
                const sample = await sink.getCanvas(timestamp);
                const bytes = sample.canvas.getContext("2d").getImageData(0, 0, 128, 96).data;
                hashes.push([...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].join(","));
                const expected = renderScene({ ...scene, time: scene.time + timestamp }, renderer, "rgba").pixels;
                let error = 0;
                for (let i = 0; i < bytes.length; i++) error += Math.abs(bytes[i] - expected[i]);
                errors.push(error / bytes.length);
              }
              videos[format] = { type: blob.type, header, bytes: blob.size, codec: await track.getCodec(), width: await track.getCodedWidth(), height: await track.getCodedHeight(), duration: await input.computeDuration(), packets, hashes, errors, progress };
            } finally { input.dispose(); }
          }
          const largeScene = { ...scene, params: { ...scene.params, width: 1500, height: 1500, cellSize: 128 } };
          const largeSupport = await getExportSupport(1500, 1500, 4);
          const largeBlob = await exportScene(largeScene, renderer, { format: "mp4", duration: 0.75, fps: 4 });
          const largeInput = new Input({ source: new BlobSource(largeBlob), formats: ALL_FORMATS });
          let large;
          try {
            const track = await largeInput.getPrimaryVideoTrack();
            let count = 0;
            for await (const packet of new EncodedPacketSink(track).packets()) count++;
            const sink = new CanvasSink(track);
            const hashes = [];
            for (const timestamp of [0, 0.5]) {
              const sample = await sink.getCanvas(timestamp);
              const bytes = sample.canvas.getContext("2d").getImageData(0, 0, 1500, 1500).data;
              hashes.push([...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].join(","));
            }
            large = { count, width: await track.getCodedWidth(), height: await track.getCodedHeight(), duration: await largeInput.computeDuration(), codec: await track.getCodec(), support: largeSupport.mp4, hashes };
          } finally { largeInput.dispose(); }
          const images = {};
          for (const format of ["jpeg", "webp"]) {
            const blob = await exportScene({ ...scene, params: { ...scene.params, transparent: true } }, renderer, { format, background: "#ffffff" });
            const image = await createImageBitmap(blob);
            images[format] = { type: blob.type, width: image.width, height: image.height, header: [...new Uint8Array(await blob.slice(0, 12).arrayBuffer())] };
            image.close();
          }
          const controller = new AbortController();
          let cancellation = "";
          try { await exportScene(scene, renderer, { format: "mp4", duration: 2, fps: 12, signal: controller.signal, onProgress(p) { if (p.completed === 2) controller.abort(); } }); } catch (error) { cancellation = error.name; }
          return { support, videos, large, images, cancellation, created, disposed };
        };
      ` }));
    } }] });
    expect(build.success).toBe(true);
    const bundle = await build.outputs[0]!.text();
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
      const path = new URL(request.url).pathname;
      return path === "/kor.wasm" ? new Response(Bun.file(artifact)) : path === "/proof.js" ? new Response(bundle, { headers: { "Content-Type": "text/javascript" } }) : new Response('<script src="/proof.js"></script>', { headers: { "Content-Type": "text/html" } });
    } });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}`);
      const result = await page.evaluate(() => (window as unknown as { proof(): Promise<any> }).proof());
      console.info("Export runtime proof", JSON.stringify({ browser: browser.version(), ...result }));
      for (const format of ["mp4", "webm"]) {
        const video = result.videos[format];
        expect(video.type).toBe(`video/${format}`);
        expect(video.width).toBe(128);
        expect(video.height).toBe(96);
        expect(video.packets).toHaveLength(12);
        expect(video.duration).toBeCloseTo(1, 4);
        expect(new Set(video.hashes).size).toBeGreaterThan(1);
        for (const error of video.errors) expect(error).toBeLessThan(15);
        expect(video.progress).toEqual(Array.from({ length: 13 }, (_, index) => index));
        const timestamps = video.packets.map((p: { timestamp: number }) => p.timestamp).sort((a: number, b: number) => a - b);
        timestamps.forEach((time: number, index: number) => expect(time).toBeCloseTo(index / 12, 3));
      }
      expect(String.fromCharCode(...result.videos.mp4.header.slice(4, 8))).toBe("ftyp");
      expect(result.videos.webm.header.slice(0, 4)).toEqual([26, 69, 223, 163]);
      expect(result.support.jpeg.supported).toBe(true);
      expect(result.support.webp.supported).toBe(true);
      expect(result.images.jpeg.type).toBe("image/jpeg");
      expect(result.images.jpeg.header.slice(0, 3)).toEqual([255, 216, 255]);
      expect(result.images.webp.type).toBe("image/webp");
      expect(String.fromCharCode(...result.images.webp.header.slice(8, 12))).toBe("WEBP");
      expect(result.large).toMatchObject({ count: 3, width: 1500, height: 1500, duration: 0.75, support: { supported: true } });
      expect(new Set(result.large.hashes).size).toBe(2);
      expect(result.cancellation).toBe("AbortError");
      expect(result.created).toBe(result.disposed);
    } finally { await browser.close(); server.stop(true); }
  }, 60_000);
});
