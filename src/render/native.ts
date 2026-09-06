export interface SvgRaster {
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
}

export interface SvgDocument {
  readonly size: Readonly<{ width: number; height: number }>;
  render(width: number, height: number): SvgRaster;
  png(width: number, height: number): Uint8Array<ArrayBuffer>;
  serialize(): Uint8Array<ArrayBuffer>;
  dispose(): void;
}

export interface SvgRenderer {
  createDocument(source: string | Uint8Array): SvgDocument;
}

interface NativeExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(length: number): number;
  free(pointer: number): void;
  taxis_parse(pointer: number, length: number): number;
  taxis_size(document: number, output: number): number;
  taxis_render_rgba(document: number, width: number, height: number, stride: number): number;
  taxis_serialize(document: number, length: number): number;
  taxis_png(document: number, length: number): number;
  taxis_error(): number;
  taxis_free(document: number): void;
}

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 16_777_216;
const FUNCTIONS = [
  "_initialize", "malloc", "free", "taxis_parse", "taxis_size", "taxis_render_rgba",
  "taxis_serialize", "taxis_png", "taxis_error", "taxis_free",
] as const;

/** The host chooses and loads the artifact. No fetch, DOM, or fallback engine is used here. */
export async function createSvgRenderer(bytes: BufferSource): Promise<SvgRenderer> {
  const module = await WebAssembly.compile(bytes);
  if (WebAssembly.Module.imports(module).length !== 0) {
    throw new Error("The SVG renderer must be a standalone WebAssembly module with no imports.");
  }
  const instance = await WebAssembly.instantiate(module, {});
  const native = instance.exports as NativeExports;
  if (!(native.memory instanceof WebAssembly.Memory) || FUNCTIONS.some((name) => typeof native[name] !== "function")) {
    throw new Error("The WebAssembly module does not provide the Kor renderer API.");
  }
  native._initialize();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function nativeError(): Error {
    const pointer = native.taxis_error();
    const bytes = new Uint8Array(native.memory.buffer, pointer, 256);
    const end = bytes.indexOf(0);
    return new Error(decoder.decode(bytes.subarray(0, end < 0 ? bytes.length : end)) || "The native SVG renderer failed.");
  }

  return {
    createDocument(source): SvgDocument {
      if (typeof source !== "string" && !(source instanceof Uint8Array)) {
        throw new TypeError("SVG source must be text or a Uint8Array.");
      }
      if (source.length === 0 || source.length > MAX_SOURCE_BYTES) {
        throw new Error("SVG source must contain 1 to 33,554,432 bytes.");
      }
      const bytes = typeof source === "string" ? encoder.encode(source) : source;
      if (bytes.length > MAX_SOURCE_BYTES) throw new Error("SVG source exceeds 32 MiB.");
      const input = native.malloc(bytes.length);
      if (!input) throw new Error("Not enough WebAssembly memory to copy the SVG source.");
      let handle = 0;
      let output = 0;
      let size: SvgDocument["size"];
      try {
        new Uint8Array(native.memory.buffer).set(bytes, input);
        handle = native.taxis_parse(input, bytes.length);
        if (!handle) throw nativeError();
        output = native.malloc(16);
        if (!output) throw new Error("Not enough WebAssembly memory for the SVG document.");
        if (!native.taxis_size(handle, output)) throw nativeError();
        const dimensions = new Float64Array(native.memory.buffer, output, 2);
        const width = dimensions[0] ?? 0;
        const height = dimensions[1] ?? 0;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          throw new Error("The SVG canvas has invalid dimensions.");
        }
        size = Object.freeze({ width, height });
      } catch (error) {
        if (handle) native.taxis_free(handle);
        if (output) native.free(output);
        throw error;
      } finally {
        native.free(input);
      }

      function renderContext(width: number, height: number): { pointer: number; stride: number } {
        if (!handle) throw new Error("The SVG document has been disposed.");
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) {
          throw new Error("Render dimensions must be positive integers with at most 16,777,216 pixels.");
        }
        const pointer = native.taxis_render_rgba(handle, width, height, output);
        if (!pointer) throw nativeError();
        const stride = new Uint32Array(native.memory.buffer, output, 1)[0] ?? 0;
        if (stride !== width * 4) throw new Error("The native SVG renderer returned an unsupported pixel stride.");
        return { pointer, stride };
      }

      return {
        size,
        render(width, height): SvgRaster {
          const { pointer, stride } = renderContext(width, height);
          const pixels = new Uint8ClampedArray(native.memory.buffer, pointer, stride * height).slice();
          return { width, height, stride, pixels };
        },
        png(width, height): Uint8Array<ArrayBuffer> {
          renderContext(width, height);
          const pointer = native.taxis_png(handle, output);
          if (!pointer) throw nativeError();
          const length = new Uint32Array(native.memory.buffer, output, 1)[0] ?? 0;
          return new Uint8Array(native.memory.buffer, pointer, length).slice();
        },
        serialize(): Uint8Array<ArrayBuffer> {
          if (!handle) throw new Error("The SVG document has been disposed.");
          const pointer = native.taxis_serialize(handle, output);
          if (!pointer) throw nativeError();
          const length = new Uint32Array(native.memory.buffer, output, 1)[0] ?? 0;
          return new Uint8Array(native.memory.buffer, pointer, length).slice();
        },
        dispose(): void {
          if (!handle) return;
          native.taxis_free(handle);
          native.free(output);
          handle = 0;
        },
      };
    },
  };
}
