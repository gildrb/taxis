import type { PARAMETER_SCHEMA } from "./model/params";
import type { PatternFrame, PatternProject } from "./model/types";
import type { SvgRaster } from "./render/native";
import type { ExportOptions } from "./export/encode";

export { createSvgRenderer } from "./render/native";
export { renderScene } from "./render/scene";
export { exportScene, getExportSupport, videoFrameCount } from "./export/encode";
export type { ExportFormat, ExportOptions, ExportSupport } from "./export/encode";
export type { SvgDocument, SvgRaster, SvgRenderer } from "./render/native";

export { DEFAULT_PARAMS, PARAMETER_SCHEMA, parsePreset, projectFingerprint } from "./model/params";
export { generatePattern, patternToSvg, projectFor } from "./model/pattern";
export { createRadialSource, dataUrlToSource, fileToSource, parseVectorMask, pixelsToSource } from "./model/source";
export { createKeyframeEvaluator, KEYFRAME_LIMITS, KEYFRAME_PROPERTIES, KEYFRAME_VALUE_RANGES } from "./model/keyframes";
export { parseProject } from "./model/project";
export type { AnimationKeyframe, KeyframeEasing, KeyframePose, KeyframeProperty, KeyframeTrack, CellAnimationOverride, CellEntity, CellShape, LayoutCellOverride, MaskShape, PatternParams, PatternFrame, PatternProject, RenderInput, SourceData, VectorMask } from "./model/types";

export interface TaxisApi {
  version: 1;
  renderer: "Kor/Archetypon";
  schema: typeof PARAMETER_SCHEMA;
  getScene(): PatternProject;
  setParams(patch: unknown): PatternProject;
  setScene(scene: unknown): Promise<PatternProject>;
  setSource(file: File): Promise<PatternProject>;
  evaluate(time?: number): PatternFrame;
  svg(time?: number): string;
  render(time?: number): SvgRaster;
  png(time?: number): Uint8Array<ArrayBuffer>;
  export(options: ExportOptions, time?: number): Promise<Blob>;
}

declare global {
  interface Window {
    taxis: TaxisApi;
  }
}
