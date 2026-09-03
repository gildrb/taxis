export type PatternPreset = "bars" | "candles" | "shapes";
export type PatternColorMode = "custom" | "monochrome" | "source";
export type SourceFit = "contain" | "cover" | "stretch";
export type SampleChannel = "auto" | "alpha" | "luminance";

export interface PatternParams {
  preset: PatternPreset;
  cellSize: number;
  rowShift: number;
  colorMode: PatternColorMode;
  monoColor: string;
  sourceBackground: number;
  invert: boolean;
  contrast: number;
  luminanceBias: number;
  colorCount: 2 | 3 | 4;
  backgroundColor: string;
  colors: [string, string, string, string];
  transparent: boolean;
  fit: SourceFit;
  sampleChannel: SampleChannel;
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface SourceData {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  usesAlpha: boolean;
  name: string;
  fingerprint: string;
  dataUrl?: string;
  kind?: "radial";
}

export interface RenderInput {
  params: PatternParams;
  source: SourceData;
}

export interface PatternPrimitive {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
}

export interface PatternFrame {
  width: number;
  height: number;
  background: string | null;
  primitives: PatternPrimitive[];
}

export interface SourceSample {
  red: number;
  green: number;
  blue: number;
  alpha: number;
  value: number;
}

export interface PatternProject {
  app: "Pattern Lab";
  version: 2;
  fingerprint: string;
  params: PatternParams;
  source: {
    name: string;
    fingerprint: string;
    usesAlpha: boolean;
    dataUrl?: string;
    kind?: "radial";
    size?: number;
  };
}
