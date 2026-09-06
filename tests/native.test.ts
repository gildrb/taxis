import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { createSvgRenderer, type SvgRenderer } from "../src/render/native";

const artifact = new URL("../public/renderer/kor.wasm", import.meta.url);
let renderer: SvgRenderer;

beforeAll(async () => {
  renderer = await createSvgRenderer(await Bun.file(artifact).arrayBuffer());
});

const groupedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><metadata>editable &amp; exact</metadata><g id="first" data-layer="0"><rect width="8" height="8" fill="#ff0000"/></g><g data-layer="1" opacity="0.5"><rect x="4" width="4" height="8" fill="#0000ff"/></g></svg>`;
const maskedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><defs><mask id="a" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="8" height="8" mask-type="alpha"><path d="M0 0H6V8H0Z" fill="white"/></mask><mask id="b" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="8" height="8" mask-type="alpha"><path d="M0 0H8V4H0Z" fill="black" opacity="0.5"/></mask></defs><g mask="url(#a)"><g mask="url(#b)"><rect width="8" height="8" fill="#ff0000"/></g></g></svg>`;

function decodePng(png: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  expect(png[24]).toBe(8);
  expect(png[25]).toBe(6);
  const chunks: Uint8Array[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    if (type === "IDAT") chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    // Archetypon's deterministic encoder currently emits unfiltered RGBA rows.
    expect(raw[y * (stride + 1)]).toBe(0);
    pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, pixels };
}

describe("standalone retained Kor renderer", () => {
  test("matches the pinned artifact, source archives and C bridge", async () => {
    const lock = await Bun.file(new URL("../native/renderer.lock.json", import.meta.url)).json();
    expect(lock.compiler.name).toBe("zig");
    expect(lock.compiler.version).toBe("0.16.0");
    expect(lock.sources.map((source: { repository: string }) => source.repository)).toEqual(["gildrb/kor", "gildrb/archetypon"]);
    for (const source of lock.sources) {
      expect(source.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(source.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    const bytes = new Uint8Array(await Bun.file(artifact).arrayBuffer());
    const bridge = new Uint8Array(await Bun.file(new URL("../native/bridge.c", import.meta.url)).arrayBuffer());
    expect(lock.artifact.path).toBe("public/renderer/kor.wasm");
    expect(bytes.length).toBe(lock.artifact.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(lock.artifact.sha256);
    expect(createHash("sha256").update(bridge).digest("hex")).toBe(lock.bridge.sha256);
    expect(await Bun.file(new URL("../native/renderer.development.json", import.meta.url)).exists()).toBe(false);
  });

  test("has no runtime imports and rejects modules without the bridge API", async () => {
    const module = await WebAssembly.compile(await Bun.file(artifact).arrayBuffer());
    expect(WebAssembly.Module.imports(module)).toEqual([]);
    await expect(createSvgRenderer(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).rejects.toThrow("Kor renderer API");
  });

  test("retains immutable source and editable groups with exact serialization", () => {
    const source = new TextEncoder().encode(groupedSvg);
    const document = renderer.createDocument(source);
    try {
      source.fill(0);
      expect(document.size).toEqual({ width: 8, height: 8 });
      expect(Object.isFrozen(document.size)).toBe(true);
      const serialized = document.serialize();
      expect(new TextDecoder().decode(serialized)).toBe(groupedSvg);
      serialized.fill(0);
      expect(new TextDecoder().decode(document.serialize())).toBe(groupedSvg);
      const rendered = document.render(8, 8);
      expect(rendered.stride).toBe(32);
      expect([...rendered.pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
      expect([...rendered.pixels.slice(20, 24)]).toEqual([127, 0, 128, 255]);
    } finally {
      document.dispose();
    }
  });

  test("renders nested alpha masks instead of flattening or ignoring them", () => {
    const document = renderer.createDocument(maskedSvg);
    try {
      const { pixels } = document.render(8, 8);
      expect([...pixels.slice((1 * 8 + 1) * 4, (1 * 8 + 1) * 4 + 4)]).toEqual([255, 0, 0, 128]);
      expect([...pixels.slice((1 * 8 + 7) * 4, (1 * 8 + 7) * 4 + 4)]).toEqual([0, 0, 0, 0]);
      expect([...pixels.slice((6 * 8 + 5) * 4, (6 * 8 + 5) * 4 + 4)]).toEqual([0, 0, 0, 0]);
    } finally {
      document.dispose();
    }
  });

  test("encodes the same complete RGBA pixels through Archetypon PNG", () => {
    const document = renderer.createDocument(maskedSvg);
    try {
      for (const [width, height] of [[8, 8], [16, 12], [8, 8]] as const) {
        const rendered = document.render(width, height);
        const png = document.png(width, height);
        const decoded = decodePng(png);
        expect(decoded.width).toBe(width);
        expect(decoded.height).toBe(height);
        expect(decoded.pixels).toEqual(new Uint8Array(rendered.pixels));
        expect(document.png(width, height)).toEqual(png);
      }
    } finally {
      document.dispose();
    }
  });

  test("owns result bytes across later renders, heap growth and disposal", () => {
    const document = renderer.createDocument(groupedSvg);
    const initial = document.render(8, 8).pixels;
    const expected = initial.slice();
    const png = document.png(8, 8);
    const expectedPng = png.slice();
    try {
      for (let index = 0; index < 40; index++) document.render(64 + index, 64 + index);
      const other = renderer.createDocument(`<svg width="8" height="8"><metadata>${"x".repeat(2_000_000)}</metadata><rect width="8" height="8"/></svg>`);
      other.dispose();
      expect(initial).toEqual(expected);
      expect(png).toEqual(expectedPng);
      initial.fill(0);
      expect(document.render(8, 8).pixels).toEqual(expected);
    } finally {
      document.dispose();
    }
    expect(png).toEqual(expectedPng);
  });

  test("fails closed for unsupported SVG and reports real parser diagnostics", () => {
    expect(() => renderer.createDocument('<svg width="8" height="8"><rect></svg>')).toThrow("mismatched");
    expect(() => renderer.createDocument('<svg width="8" height="8"><image href="https://example.invalid/image.png"/></svg>')).toThrow("image");
    expect(() => renderer.createDocument(new Uint8Array([0]))).toThrow("null byte");
    expect(() => renderer.createDocument("")).toThrow("SVG source");
    expect(() => renderer.createDocument(new Uint8Array(32 * 1024 * 1024 + 1))).toThrow("SVG source");
  });

  test("renders native radial paint and rejects nested references it cannot apply", () => {
    const document = renderer.createDocument('<svg width="8" height="8"><defs><radialGradient id="paint" gradientUnits="userSpaceOnUse" cx="4" cy="4" r="4" fx="4" fy="4"><stop offset="0" stop-color="rgb(255 0 0)"/><stop offset="1" stop-color="#0000ff"/></radialGradient></defs><rect width="8" height="8" fill="url(#paint)"/></svg>');
    try {
      const { pixels } = document.render(8, 8);
      const center = (3 * 8 + 3) * 4;
      expect(pixels[center]!).toBeGreaterThan(pixels[0]!);
      expect(pixels[center + 2]!).toBeLessThan(pixels[2]!);
      expect(pixels[center + 3]).toBe(255);
    } finally {
      document.dispose();
    }
    expect(() => renderer.createDocument('<svg width="8" height="8"><defs><mask id="a"><path d="M0 0H4V8H0Z" fill="white"/></mask><mask id="b"><path d="M0 0H8V8H0Z" fill="white" mask="url(#a)"/></mask></defs><g mask="url(#b)"><rect width="8" height="8"/></g></svg>')).toThrow("nested SVG clip/mask references");
  });

  test("retains masks with more than 64 component paths", () => {
    const paths = Array.from({ length: 80 }, () => '<path d="M0 0H4V8H0Z" fill="white"/>').join("");
    const document = renderer.createDocument(`<svg width="8" height="8"><defs><mask id="mask">${paths}</mask></defs><g mask="url(#mask)"><rect width="8" height="8" fill="#ff0000"/></g></svg>`);
    try {
      const { pixels } = document.render(8, 8);
      expect([...pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
      expect([...pixels.slice(28, 32)]).toEqual([0, 0, 0, 0]);
    } finally {
      document.dispose();
    }
  });

  test("rejects invalid dimensions, stale PNG requests and use after disposal", () => {
    const document = renderer.createDocument(groupedSvg);
    document.render(8, 8);
    for (const [width, height] of [[0, 8], [-1, 8], [8.5, 8], [NaN, 8], [Infinity, 8], [4097, 4097]]) {
      expect(() => document.render(width!, height!)).toThrow("Render dimensions");
      expect(() => document.png(width!, height!)).toThrow("Render dimensions");
    }
    document.dispose();
    document.dispose();
    expect(() => document.render(8, 8)).toThrow("disposed");
    expect(() => document.png(8, 8)).toThrow("disposed");
    expect(() => document.serialize()).toThrow("disposed");
  });
});
