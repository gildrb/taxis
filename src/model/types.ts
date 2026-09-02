export type OrbMode = "slices" | "dots" | "hybrid";

export interface OrbParams {
  mode: OrbMode;
  slices: number;
  dots: number;
  thickness: number;
  spacing: number;
  taper: number;
  curvature: number;
  threshold: number;
  contrast: number;
  inversion: boolean;
  crop: number;
  palette: [string, string];
  resolution: number;
  seed: number;
  breathing: number;
  wave: number;
  phase: number;
  rotation: number;
  noise: number;
  pointer: number;
  audio: number;
  duration: number;
  fps: number;
}

export interface MaskData {
  width: number;
  height: number;
  values: Float32Array;
  usesAlpha: boolean;
  name: string;
}

export interface RenderInput {
  params: OrbParams;
  mask: MaskData;
  time: number;
  pointer: readonly [number, number];
  audio: number;
}

export interface RectPrimitive {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  color: string;
  opacity: number;
}

export interface CirclePrimitive {
  kind: "circle";
  x: number;
  y: number;
  radius: number;
  color: string;
  opacity: number;
}

export type OrbPrimitive = RectPrimitive | CirclePrimitive;
