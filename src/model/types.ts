export type PatternPreset = "bars" | "candles" | "shapes" | "stripes" | "radial" | "rings";
export type PatternColorMode = "custom" | "monochrome" | "source" | "gradient";
export type SourceFit = "contain" | "cover" | "stretch";
export type SampleChannel = "auto" | "alpha" | "luminance";
export type Matrix = [number, number, number, number, number, number];
export type MaskShape = "none" | "circle" | "triangle" | "square" | "octagon" | "polygon";
export type CellShape = "square" | "circle" | "triangle" | "line" | "diamond" | "hexagon" | "octagon" | "polygon";

export interface LayoutCellOverride {
  index: number;
  offsetX?: number;
  offsetY?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  maskRotation?: number;
  maskScale?: number;
  maskShape?: MaskShape;
  padding?: number;
}

export interface VectorPath {
  d: string;
  transform: Matrix;
  fillRule: "nonzero" | "evenodd";
}

export interface VectorMask {
  viewBox: [number, number, number, number];
  paths: VectorPath[];
}

export interface PatternParams {
  preset: PatternPreset;
  useCells: boolean;
  cellShape: CellShape;
  cellSides: number;
  cellGapX: number;
  cellGapY: number;
  cellPadding: number;
  cellRotation: number;
  cellThreshold: number;
  cellSize: number;
  rowShift: number;
  rowShiftMode: "alternating" | "wave";
  symmetry: "none" | "x" | "y" | "both";
  motifScale: number;
  lineWidth: number;
  rotation: number;
  patternOffsetX: number;
  patternOffsetY: number;
  patternScaleX: number;
  patternScaleY: number;
  jitter: number;
  seed: number;
  radialCount: number;
  radialBands: number;
  innerRadius: number;
  radialTwist: number;
  radialTaper: number;
  maskShape: MaskShape;
  maskSides: number;
  maskScale: number;
  maskRotation: number;
  layoutColumns: number;
  layoutRows: number;
  layoutGapX: number;
  layoutGapY: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  layoutCells: LayoutCellOverride[];
  colorMode: PatternColorMode;
  monoColor: string;
  sourceBackground: number;
  invert: boolean;
  contrast: number;
  luminanceBias: number;
  colorCount: 2 | 3 | 4;
  backgroundColor: string;
  colors: [string, string, string, string];
  gradientType: "linear" | "radial";
  gradientStart: string;
  gradientEnd: string;
  gradientAngle: number;
  gradientCenterX: number;
  gradientCenterY: number;
  gradientSpan: number;
  transparent: boolean;
  fit: SourceFit;
  sampleChannel: SampleChannel;
  sourceMode: "sample" | "mask" | "ignore";
  sourceRotation: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  animation: "none" | "pulse" | "rotate" | "wave";
  animationDuration: number;
  animationAmount: number;
  animationPhase: number;
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
  vectorMask?: VectorMask;
}

export interface RenderInput {
  params: PatternParams;
  source: SourceData;
  time?: number;
}

export interface PatternPrimitive {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
  points?: [number, number][];
  path?: string;
}

export interface PatternGradient {
  type: "linear" | "radial";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
  start: string;
  end: string;
}

export interface PatternFrame {
  width: number;
  height: number;
  background: string | null;
  primitives: PatternPrimitive[];
  gradient?: PatternGradient;
  mask?: VectorMask;
  masks?: VectorMask[];
  layers?: PatternFrame[];
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
  version: 3;
  fingerprint: string;
  params: PatternParams;
  source: {
    name: string;
    fingerprint: string;
    usesAlpha: boolean;
    dataUrl?: string;
    kind?: "radial";
    size?: number;
    vectorMask?: VectorMask;
  };
}
