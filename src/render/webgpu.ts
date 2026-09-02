import { effect, frameLoop, init, sampler, surface, type Gpu } from "vgpu";
import type { MaskData, RenderInput } from "../model/types";

export const ORB_SHADER = /* wgsl */ `
struct Params {
  viewport: vec2f,
  pointer: vec2f,
  color_a: vec4f,
  color_b: vec4f,
  time: f32,
  mode: f32,
  slices: f32,
  dots: f32,
  thickness: f32,
  spacing: f32,
  taper: f32,
  curvature: f32,
  threshold: f32,
  contrast: f32,
  inversion: f32,
  crop: f32,
  breathing: f32,
  wave: f32,
  phase: f32,
  rotation: f32,
  noise: f32,
  pointer_amount: f32,
  audio_amount: f32,
  audio_level: f32,
  seed: f32,
}

@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;

fn hash(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(12.9898, 78.233)) + params.seed * 9.173) * 43758.5453);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = params.viewport.x / max(1.0, params.viewport.y);
  var point = uv * 2.0 - 1.0;
  point.x *= aspect;
  let radians = -params.rotation * 0.0174532925;
  let rotated = vec2f(
    point.x * cos(radians) - point.y * sin(radians),
    point.x * sin(radians) + point.y * cos(radians)
  );
  point = rotated;
  point -= params.pointer * params.pointer_amount * vec2f(0.08, 0.08);
  let pulse = 1.0 + params.breathing * sin(6.2831853 * (params.time + params.phase))
    + params.audio_level * params.audio_amount * 0.08;
  point /= pulse;
  point.x -= params.wave * sin(6.2831853 * (point.y * 0.72 + params.time + params.phase));
  point.x -= params.curvature * (1.0 - point.y * point.y) * 0.22;
  let taper = 1.0 - params.taper * pow(abs(point.y), 1.7) * 0.42;
  point.x /= max(0.25, taper);
  let object_uv = point / 0.84 * 0.5 + 0.5;
  let source_uv = (object_uv - 0.5) / params.crop + 0.5;
  if (any(source_uv < vec2f(0.0)) || any(source_uv > vec2f(1.0))) {
    discard;
  }
  var mask = textureSample(source_texture, source_sampler, source_uv).r;
  if (params.inversion > 0.5) { mask = 1.0 - mask; }
  mask = clamp((mask - 0.5) * params.contrast + 0.5, 0.0, 1.0);
  if (mask < params.threshold) { discard; }

  let row_position = object_uv.y * params.slices;
  let row = floor(row_position);
  let row_distance = abs(fract(row_position) - 0.5) * 2.0;
  let band = 1.0 - step(params.thickness * (1.0 - params.spacing * 0.55), row_distance);
  let column_position = object_uv.x * params.dots;
  let grid_uv = vec2f(fract(column_position) - 0.5, fract(row_position) - 0.5);
  let dot_radius = params.thickness * (1.0 - params.spacing * 0.38) * 0.46 * (0.3 + mask * 0.7);
  let dot = 1.0 - smoothstep(dot_radius * 0.82, dot_radius, length(grid_uv));
  let hybrid_dot = select(band, dot, (i32(row) % 3) != 0);
  var pattern = select(band, dot, params.mode > 0.5);
  pattern = select(pattern, hybrid_dot, params.mode > 1.5);
  let grain = (hash(vec2f(floor(column_position), row)) - 0.5) * params.noise;
  let alpha = pattern * clamp(0.42 + mask * 0.58 + grain, 0.0, 1.0);
  if (alpha < 0.01) { discard; }
  let color = mix(params.color_a, params.color_b, clamp(object_uv.y, 0.0, 1.0));
  return vec4f(color.rgb, alpha);
}
`;

const COPY_DST = 0x02;
const TEXTURE_BINDING = 0x04;

export interface WebGpuController {
  dispose(): void;
}

export async function mountWebGpu(
  canvas: HTMLCanvasElement,
  readInput: () => RenderInput,
  onError: (message: string) => void,
): Promise<WebGpuController> {
  let gpu: Gpu | undefined;
  let texture: GPUTexture | undefined;
  try {
    gpu = await init({ powerPreference: "high-performance", label: "Orb Lab" });
    const screen = surface(gpu, canvas, {
      alphaMode: "premultiplied",
      clearColor: [0.06, 0.07, 0.067, 1],
      dpr: [1, 2],
    });
    const sample = sampler(gpu, {
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    let activeMask: MaskData | undefined;
    let orb: ReturnType<typeof effect> | undefined;

    const updateTexture = (mask: MaskData) => {
      texture?.destroy();
      texture = gpu!.gpu.createTexture({
        label: "Orb source mask",
        size: [mask.width, mask.height],
        format: "rgba8unorm",
        usage: TEXTURE_BINDING | COPY_DST,
      });
      const pixels = new Uint8Array(mask.width * mask.height * 4);
      for (let index = 0; index < mask.values.length; index++) {
        const value = Math.round((mask.values[index] ?? 0) * 255);
        const offset = index * 4;
        pixels[offset] = value;
        pixels[offset + 1] = value;
        pixels[offset + 2] = value;
        pixels[offset + 3] = 255;
      }
      gpu!.gpu.queue.writeTexture(
        { texture },
        pixels,
        { bytesPerRow: mask.width * 4, rowsPerImage: mask.height },
        { width: mask.width, height: mask.height },
      );
      activeMask = mask;
    };

    const initial = readInput();
    updateTexture(initial.mask);
    orb = effect(gpu, ORB_SHADER, {
      set: { source_texture: texture, source_sampler: sample, params: orbUniforms(initial, screen.size) },
    });
    gpu.onError((error) => onError(error.message));
    const loop = frameLoop(gpu, (frame) => {
      const input = readInput();
      if (input.mask !== activeMask) {
        updateTexture(input.mask);
        orb!.set({ source_texture: texture });
      }
      orb!.set({ params: orbUniforms(input, screen.size) });
      frame.pass(screen, orb!);
    });
    return {
      dispose() {
        loop.stop();
        texture?.destroy();
        gpu?.dispose();
      },
    };
  } catch (error) {
    texture?.destroy();
    gpu?.dispose();
    throw error;
  }
}

export function orbUniforms(input: RenderInput, viewport: readonly [number, number]) {
  const { params } = input;
  return {
    viewport,
    pointer: input.pointer,
    color_a: color(params.palette[0]),
    color_b: color(params.palette[1]),
    time: input.time,
    mode: params.mode === "slices" ? 0 : params.mode === "dots" ? 1 : 2,
    slices: params.slices,
    dots: params.dots,
    thickness: params.thickness,
    spacing: params.spacing,
    taper: params.taper,
    curvature: params.curvature,
    threshold: params.threshold,
    contrast: params.contrast,
    inversion: params.inversion ? 1 : 0,
    crop: params.crop,
    breathing: params.breathing,
    wave: params.wave,
    phase: params.phase,
    rotation: params.rotation,
    noise: params.noise,
    pointer_amount: params.pointer,
    audio_amount: params.audio,
    audio_level: input.audio,
    seed: params.seed,
  };
}

function color(hex: string): [number, number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
}
