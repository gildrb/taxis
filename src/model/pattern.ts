import { geometricMask, geometricMaskContains, maskForSource, sampleSource, sourceCoverage } from "./source";
import { canonicalizePatternParams, projectFingerprint } from "./params";
import { createKeyframeEvaluator, type KeyframeEvaluator } from "./keyframes";
import { multiplyMatrices, parseVectorMask } from "./svg-mask";
import type {
  CellAnimationOverride,
  CellEntity,
  Matrix,
  PatternFrame,
  PatternGradient,
  PatternParams,
  PatternPrimitive,
  PatternProject,
  RenderInput,
  SourceSample,
  VectorMask,
} from "./types";

type UnitRect = readonly [x: number, y: number, width: number, height: number];

const BAR_PATTERNS: readonly (readonly UnitRect[])[] = [
  [[0, 28 / 64, 1, 8 / 64]],
  [[0, 20 / 64, 1, 24 / 64]],
  [[0, 12 / 64, 1, 40 / 64]],
  [[0, 4 / 64, 1, 56 / 64]],
  [[0, 12 / 64, 1, 40 / 64]],
  [[0, 20 / 64, 1, 24 / 64]],
];

const CANDLE_PATTERNS: readonly (readonly UnitRect[])[] = [
  [[7 / 16, 0, 2 / 16, 1]],
  [[5 / 16, 0, 6 / 16, 1]],
  [[3 / 16, 0, 10 / 16, 1]],
  [[1 / 16, 0, 14 / 16, 1]],
];

const SHAPE_PATTERNS: readonly (readonly UnitRect[])[] = [
  [[31.5 / 64, 31.5 / 64, 1 / 64, 1 / 64]],
  [[28 / 64, 28 / 64, 8 / 64, 8 / 64]],
  [[28 / 64, 16 / 64, 8 / 64, 32 / 64]],
  [[28 / 64, 16 / 64, 8 / 64, 32 / 64], [16 / 64, 28 / 64, 32 / 64, 8 / 64]],
  [[16 / 64, 16 / 64, 32 / 64, 32 / 64]],
  [[0, 0, 3 / 8, 3 / 8], [5 / 8, 0, 3 / 8, 3 / 8],
    [0, 5 / 8, 3 / 8, 3 / 8], [5 / 8, 5 / 8, 3 / 8, 3 / 8]],
];

const MAX_CELLS = 250_000;
const MAX_PRIMITIVES = 25_000;
const MAX_MASK_CHARACTERS = 4_000_000;

type Point = [number, number];

interface PatternMotion {
  transform: Matrix;
  phase: number;
}

interface LayoutCell {
  index: number;
  params: PatternParams;
  motion: PatternMotion;
  copyMotion: PatternMotion;
  clip: boolean;
}

export function generatePattern(input: RenderInput): PatternFrame {
  const { params } = input;
  const time = params.animationTime + (input.time ?? 0);
  // Cell animation belongs to each entity. Scene placement never pulses or rotates the whole cell field.
  const globalMotion = patternMotion(params.useCells ? { ...params, animation: "none" } : params, time);
  const availableWidth = params.width - params.paddingLeft - params.paddingRight - (params.layoutColumns - 1) * params.layoutGapX;
  const availableHeight = params.height - params.paddingTop - params.paddingBottom - (params.layoutRows - 1) * params.layoutGapY;
  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new Error("Layout padding and gaps leave no space for forms. Reduce padding, gaps, or subdivisions.");
  }
  const cellWidth = availableWidth / params.layoutColumns;
  const cellHeight = availableHeight / params.layoutRows;
  const count = params.layoutColumns * params.layoutRows;
  const overrides = new Map(params.layoutCells.map((cell) => [cell.index, cell]));
  const cells: LayoutCell[] = [];
  let totalCells = 0;
  let totalPrimitives = 0;
  let totalMaskCharacters = 0;
  const sourcePaths = !params.useCells && params.sourceMode === "mask"
    ? input.source.kind === "radial" ? 1 : input.source.vectorMask?.paths.length ?? 0 : 0;
  const sourceCharacters = !params.useCells && params.sourceMode === "mask"
    ? input.source.kind === "radial" ? 256 : input.source.vectorMask?.paths.reduce((sum, path) => sum + path.d.length, 0) ?? 0 : 0;
  for (let index = 0; index < count; index++) {
    const override = overrides.get(index);
    const padding = override?.padding ?? 0;
    const width = cellWidth - 2 * padding;
    const height = cellHeight - 2 * padding;
    if (width <= 0 || height <= 0) {
      throw new Error(`Form ${index + 1} padding leaves no space. Reduce its individual padding.`);
    }
    const local: PatternParams = { ...params, width, height,
      maskShape: override?.maskShape ?? params.maskShape,
      maskScale: override?.maskScale ?? params.maskScale,
      maskRotation: override?.maskRotation ?? params.maskRotation };
    const left = params.paddingLeft + (index % params.layoutColumns) * (cellWidth + params.layoutGapX) + padding;
    const top = params.paddingTop + Math.floor(index / params.layoutColumns) * (cellHeight + params.layoutGapY) + padding;
    const localMotion = patternMotion({ ...local, animation: "none",
      rotation: override?.rotation ?? 0, patternScaleX: override?.scaleX ?? 1, patternScaleY: override?.scaleY ?? 1,
      patternOffsetX: left + (override?.offsetX ?? 0), patternOffsetY: top + (override?.offsetY ?? 0) }, 0);
    const motion = { transform: multiplyMatrices(globalMotion.transform, localMotion.transform), phase: globalMotion.phase };
    const clip = count > 1 || width !== params.width || height !== params.height;
    const [samples, primitives] = patternBudget(local);
    totalCells += samples;
    totalPrimitives += primitives + (local.useCells ? 0 : sourcePaths + (local.maskShape === "none" ? 0 : 1) + (clip ? 1 : 0));
    // Whole-cell masks select centers, so they never allocate or repeat spatial clip paths.
    // Built-in paths have at most 32 vertices; these small bounds avoid constructing every mask before the guard.
    totalMaskCharacters += local.useCells ? 0 : sourceCharacters + (local.maskShape === "none" ? 0 : 2048) + (clip ? 128 : 0);
    if (totalMaskCharacters > MAX_MASK_CHARACTERS) {
      throw new Error("This layout repeats more than 4 million mask path characters. Reduce subdivisions or simplify the source SVG.");
    }
    // The bound is for the whole scene, before allocating any primitive or mask arrays.
    if (totalCells > MAX_CELLS) throw new Error("This layout has more than 250,000 cells. Increase Cell Size or reduce subdivisions.");
    if (totalPrimitives > MAX_PRIMITIVES) throw new Error("This layout can create more than 25,000 shapes or mask paths. Increase Cell Size, reduce subdivisions/radial repeats, or simplify the source SVG.");
    const [a, b, c, d, e, f] = localMotion.transform;
    const copyMotion: PatternMotion = { phase: globalMotion.phase, transform: [a, b, c, d, e - left, f - top] };
    cells.push({ index, params: local, motion, copyMotion, clip });
  }
  const background = params.transparent ? null
    : params.colorMode === "custom" || params.colorMode === "gradient" ? params.backgroundColor : "#000000";
  const entities: CellEntity[] = [];
  const animations = new Map(params.useCells ? params.cellAnimations.map((animation) => [animation.id, animation]) : []);
  const keyframes = params.useCells && params.keyframeTracks.length > 0 ? createKeyframeEvaluator(params) : undefined;
  const frames = cells.map((cell) => generateForm({ ...input, time }, cell, entities, animations, keyframes));
  const metadata = params.useCells ? { entities } : {};
  if (count === 1) return { ...frames[0]!, background, ...metadata };
  return { width: params.width, height: params.height, background, primitives: [], layers: frames, ...metadata };
}

function patternBudget(params: PatternParams): [number, number] {
  if (params.useCells) {
    if (params.cellSize - 2 * params.cellPadding <= 0) {
      throw new Error("Cell padding leaves no shape. Reduce Cell padding below half of Cell Size.");
    }
    if (params.motifScale > 1) {
      throw new Error("Whole cells must fit their slots. Set Motif scale to 1 or less, or turn off Use cells.");
    }
    const columns = Math.floor((params.width + params.cellGapX) / (params.cellSize + params.cellGapX));
    const rows = Math.floor((params.height + params.cellGapY) / (params.cellSize + params.cellGapY));
    return [columns * rows, columns * rows];
  }
  let cells: number;
  let perCell = 1;
  if (params.preset === "radial") cells = params.radialCount * params.radialBands;
  else if (params.preset === "rings") cells = Math.ceil(Math.min(params.width, params.height) * (1 - params.innerRadius) / 2 / params.cellSize);
  else if (params.preset === "stripes") cells = Math.ceil(params.height / params.cellSize);
  else {
    cells = Math.ceil(params.width / params.cellSize) * Math.ceil(params.height / params.cellSize);
    perCell = params.preset === "shapes" ? 4 : 1;
    if (params.colorMode === "source" && params.sourceBackground > 0) perCell++;
  }
  return [cells, cells * perCell];
}

function generateForm(input: RenderInput, cell: LayoutCell, entities: CellEntity[],
  animations: ReadonlyMap<string, CellAnimationOverride>, keyframes?: KeyframeEvaluator): PatternFrame {
  const { params, motion } = cell;
  const masks: VectorMask[] = [];
  if (!params.useCells) {
    if (params.sourceMode === "mask") masks.push(maskForSource(input.source, params));
    const shapeMask = geometricMask(params);
    if (shapeMask) masks.push(shapeMask);
    if (cell.clip) masks.push({ viewBox: [0, 0, params.width, params.height], paths: [{
      d: `M 0 0 H ${format(params.width)} V ${format(params.height)} H 0 Z`,
      transform: [1, 0, 0, 1, 0, 0], fillRule: "nonzero",
    }] });
  }
  const transformed = masks.map((mask): VectorMask => ({
    viewBox: [0, 0, input.params.width, input.params.height],
    paths: mask.paths.map((path) => ({ ...path, transform: multiplyMatrices(motion.transform, path.transform) })),
  }));
  const frame: PatternFrame = {
    width: input.params.width, height: input.params.height, background: null, primitives: [],
    ...(params.colorMode === "gradient" ? { gradient: gradientFor(input.params) } : {}),
    ...(transformed[0] ? { mask: transformed[0] } : {}),
    // mask is the primary union; masks contains ADDITIONAL unions that intersect it.
    ...(transformed.length > 1 ? { masks: transformed.slice(1) } : {}),
  };
  const localInput = { ...input, params };
  if (params.useCells) generateWholeCells(frame, localInput, cell, entities, animations, keyframes);
  else if (params.preset === "stripes") generateStripes(frame, localInput, motion);
  else if (params.preset === "radial") generateRays(frame, localInput, motion);
  else if (params.preset === "rings") generateRings(frame, localInput, motion);
  else generateAtlas(frame, localInput, motion);
  return frame;
}

function generateWholeCells(frame: PatternFrame, input: RenderInput, cell: LayoutCell, entities: CellEntity[],
  animations: ReadonlyMap<string, CellAnimationOverride>, keyframes?: KeyframeEvaluator): void {
  const { params } = input;
  const pitchX = params.cellSize + params.cellGapX;
  const pitchY = params.cellSize + params.cellGapY;
  const columns = Math.floor((params.width + params.cellGapX) / pitchX);
  const rows = Math.floor((params.height + params.cellGapY) / pitchY);
  const left = (params.width - columns * params.cellSize - Math.max(0, columns - 1) * params.cellGapX) / 2;
  const top = (params.height - rows * params.cellSize - Math.max(0, rows - 1) * params.cellGapY) / 2;
  const side = (params.cellSize - 2 * params.cellPadding) * params.motifScale;
  const template = cellPolygon(params, side);
  const axisAligned = (params.cellShape === "square" || params.cellShape === "line") && params.cellRotation === 0;
  for (let row = 0; row < rows; row++) {
    const shift = rowDisplacement(row, rows, params, 0, false);
    for (let column = 0; column < columns; column++) {
      const id = `cell:${cell.index}:${row}:${column}`;
      // This rest-grid address and sample position never depend on time or visibility.
      const cx = left + params.cellSize / 2 + column * pitchX + shift + noise(params.seed, row, column, 0) * params.jitter * params.cellSize;
      const cy = top + params.cellSize / 2 + row * pitchY + noise(params.seed, row, column, 1) * params.jitter * params.cellSize;
      const override = animations.get(id);
      const animation = override?.animation ?? params.animation;
      const duration = override?.animationDuration ?? params.animationDuration;
      const amount = override?.animationAmount ?? params.animationAmount;
      const authoredPhase = override?.animationPhase ?? params.animationPhase;
      const axis = override?.animationAxis ?? params.animationAxis;
      const staggerBy = override?.animationStaggerBy ?? params.animationStaggerBy;
      const staggerIndex = staggerBy === "column" ? column : staggerBy === "row" ? row : staggerBy === "index" ? row * columns + column : 0;
      const stagger = animation === "wave" ? (override?.animationStagger ?? params.animationStagger) * staggerIndex : 0;
      const elapsed = animation === "none" ? 0 : (input.time ?? 0) / duration;
      const phase = Number((((authoredPhase + elapsed + stagger) % 1 + 1) % 1).toFixed(12)) % 1;
      const keyed = keyframes?.(id, input.time ?? 0);
      const scale = (animation === "pulse" ? 1 + amount * Math.sin(phase * Math.PI * 2) : 1) * (keyed?.scale ?? 1);
      const rotation = (animation === "rotate" ? phase * 360 : 0) + (keyed?.rotation ?? 0);
      const opacity = keyed?.opacity ?? 1;
      const displacement = animation === "wave" ? Math.sin(phase * Math.PI * 2) * amount * params.cellSize : 0;
      const x = cx + (axis === "x" ? displacement : 0) + (keyed?.x ?? 0);
      const y = cy + (axis === "y" ? displacement : 0) + (keyed?.y ?? 0);
      const [restX, restY] = transformPoint(cx, cy, cell.motion);
      const [poseX, poseY] = transformPoint(x, y, cell.motion);
      const entity: CellEntity = { id, repeatIndex: cell.index, row, column,
        rest: { x: restX, y: restY }, pose: { x: poseX, y: poseY, scale, rotation, opacity, phase },
        selected: false, visible: false, hiddenReason: null, primitive: null };
      entities.push(entity);
      // Selection and paint belong to rest topology, not the animated sample position.
      if (!geometricMaskContains(params, cx, cy)) {
        entity.hiddenReason = "pattern-clip";
        continue;
      }
      if (params.sourceMode === "mask" && sourceCoverage(input.source, cx, cy, params) < params.cellThreshold) {
        entity.hiddenReason = "source";
        continue;
      }
      const paint = paintAt(input, cx, cy);
      if (!paint || (params.sourceMode === "sample" && paint.value < params.cellThreshold)) {
        entity.hiddenReason = "source";
        continue;
      }
      entity.selected = true;
      const cosine = Number(Math.cos(rotation * Math.PI / 180).toFixed(12)) * scale;
      const sine = Number(Math.sin(rotation * Math.PI / 180).toFixed(12)) * scale;
      const localPose: Matrix = [cosine, sine, -sine, cosine, x - cosine * cx + sine * cy, y - sine * cx - cosine * cy];
      const motion: PatternMotion = { phase, transform: multiplyMatrices(cell.motion.transform, localPose) };
      const copyMotion: PatternMotion = { phase, transform: multiplyMatrices(cell.copyMotion.transform, localPose) };
      let primitive: PatternPrimitive;
      let copyFits: boolean;
      if (params.cellShape === "circle") {
        const radius = side / 2;
        const [a, b, c, d] = copyMotion.transform;
        const [copyX, copyY] = transformPoint(cx, cy, copyMotion);
        const halfWidth = radius * Math.hypot(a, c);
        const halfHeight = radius * Math.hypot(b, d);
        copyFits = boundsInside(copyX - halfWidth, copyY - halfHeight, 2 * halfWidth, 2 * halfHeight, params.width, params.height);
        primitive = annulusPrimitive(cx, cy, radius, 0, paint.color, paint.opacity, motion);
      } else {
        const local = template.map(([x, y]): Point => [cx + x, cy + y]);
        const copy = local.map(([x, y]) => transformPoint(x, y, copyMotion));
        copyFits = copy.every(([x, y]) => boundsInside(x, y, 0, 0, params.width, params.height));
        const points = local.map(([x, y]) => transformPoint(x, y, motion));
        const x = Math.min(...points.map(([x]) => x));
        const y = Math.min(...points.map(([, y]) => y));
        const width = Math.max(...points.map(([x]) => x)) - x;
        const height = Math.max(...points.map(([, y]) => y)) - y;
        const [a, b, c, d] = motion.transform;
        primitive = { x, y, width, height, color: paint.color, opacity: paint.opacity,
          ...(axisAligned && b === 0 && c === 0 && a >= 0 && d >= 0 ? {} : { points }) };
      }
      primitive.opacity *= opacity;
      primitive.entityId = id;
      entity.primitive = primitive;
      // Retain full geometry and stable IDs when a posed cell is invisible. Never cut a cell.
      entity.hiddenReason = primitive.opacity === 0 ? "opacity" : primitive.width <= 1e-8 || primitive.height <= 1e-8 ? "collapsed"
        : !copyFits ? "repeat-bounds"
          : !boundsInside(primitive.x, primitive.y, primitive.width, primitive.height, frame.width, frame.height) ? "canvas-bounds" : null;
      entity.visible = entity.hiddenReason === null;
      if (entity.visible) frame.primitives.push(primitive);
    }
  }
}

function cellPolygon(params: PatternParams, side: number): Point[] {
  if (params.cellShape === "circle") return [];
  let vertices: Point[];
  if (params.cellShape === "square" || params.cellShape === "line") {
    const halfHeight = params.cellShape === "line" ? params.lineWidth / 2 : 0.5;
    vertices = [[-0.5, -halfHeight], [0.5, -halfHeight], [0.5, halfHeight], [-0.5, halfHeight]];
  } else {
    const sides = params.cellShape === "triangle" ? 3 : params.cellShape === "diamond" ? 4
      : params.cellShape === "hexagon" ? 6 : params.cellShape === "octagon" ? 8 : params.cellSides;
    const start = -Math.PI / 2 + (sides % 2 === 0 && params.cellShape !== "diamond" ? Math.PI / sides : 0);
    vertices = Array.from({ length: sides }, (_, index): Point => {
      const angle = start + index * Math.PI * 2 / sides;
      return [Math.cos(angle), Math.sin(angle)];
    });
  }
  const angle = params.cellRotation * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotated = vertices.map(([x, y]): Point => [cosine * x - sine * y, sine * x + cosine * y]);
  const left = Math.min(...rotated.map(([x]) => x));
  const right = Math.max(...rotated.map(([x]) => x));
  const top = Math.min(...rotated.map(([, y]) => y));
  const bottom = Math.max(...rotated.map(([, y]) => y));
  const scale = side / Math.max(right - left, bottom - top);
  return rotated.map(([x, y]) => [(x - (left + right) / 2) * scale, (y - (top + bottom) / 2) * scale]);
}

function boundsInside(x: number, y: number, width: number, height: number, limitWidth: number, limitHeight: number): boolean {
  const epsilon = 1e-8;
  return x >= -epsilon && y >= -epsilon && x + width <= limitWidth + epsilon && y + height <= limitHeight + epsilon;
}

function generateAtlas(frame: PatternFrame, input: RenderInput, motion: PatternMotion): void {
  const { params } = input;
  const patterns = params.preset === "bars" ? BAR_PATTERNS
    : params.preset === "candles" ? CANDLE_PATTERNS
      : SHAPE_PATTERNS;
  const columns = Math.ceil(params.width / params.cellSize);
  const rows = Math.ceil(params.height / params.cellSize);
  const left = (params.width - columns * params.cellSize) / 2;
  const top = (params.height - rows * params.cellSize) / 2;
  const mergeBars = params.preset === "bars" && params.motifScale === 1 && params.jitter === 0
    && (params.colorMode !== "source" || params.sourceBackground === 0);
  for (let row = 0; row < rows; row++) {
    const rowRects: PatternPrimitive[] = [];
    let previousColumn = -2;
    const shift = rowDisplacement(row, rows, params, motion.phase);
    for (let column = 0; column < columns; column++) {
      const x = left + column * params.cellSize + shift + noise(params.seed, row, column, 0) * params.jitter * params.cellSize;
      const y = top + row * params.cellSize + noise(params.seed, row, column, 1) * params.jitter * params.cellSize;
      // Cropped cells sample the visible portion on BOTH edges, not the nominal cell center.
      const sampleX = (Math.max(0, x) + Math.min(params.width, x + params.cellSize)) / 2;
      const sampleY = (Math.max(0, y) + Math.min(params.height, y + params.cellSize)) / 2;
      const paint = paintAt(input, sampleX, sampleY);
      if (!paint) continue;
      const patternIndex = Math.min(patterns.length - 1, Math.floor(paint.value * (patterns.length - 1)));
      const pattern = patterns[patternIndex] ?? patterns[0]!;
      if (params.colorMode === "source" && params.sourceBackground > 0) {
        appendRect(frame.primitives, x, y, params.cellSize, params.cellSize,
          rgb(paint.sample.red, paint.sample.green, paint.sample.blue), params.sourceBackground * paint.sample.alpha, motion);
      }
      const size = params.cellSize * params.motifScale;
      for (const [unitX, unitY, unitWidth, unitHeight] of pattern) {
        const rect = { x: x + params.cellSize / 2 + (unitX - 0.5) * size,
          y: y + params.cellSize / 2 + (unitY - 0.5) * size,
          width: unitWidth * size, height: unitHeight * size, color: paint.color, opacity: paint.opacity };
        if (mergeBars) {
          const previous = rowRects.at(-1);
          // Join exact touching equal-paint bars BEFORE rotation to avoid internal antialias seams.
          if (previous && previousColumn === column - 1 && previous.y === rect.y
            && previous.height === rect.height && previous.color === rect.color && previous.opacity === rect.opacity) previous.width += rect.width;
          else rowRects.push(rect);
          previousColumn = column;
        } else appendRect(frame.primitives, rect.x, rect.y, rect.width, rect.height, rect.color, rect.opacity, motion);
      }
    }
    for (const rect of rowRects) appendRect(frame.primitives, rect.x, rect.y, rect.width, rect.height, rect.color, rect.opacity, motion);
  }
}

function generateStripes(frame: PatternFrame, input: RenderInput, motion: PatternMotion): void {
  const { params } = input;
  const rows = Math.ceil(params.height / params.cellSize);
  const top = (params.height - rows * params.cellSize) / 2;
  const thickness = params.cellSize * params.lineWidth;
  for (let row = 0; row < rows; row++) {
    const cellY = top + row * params.cellSize;
    const dx = rowDisplacement(row, rows, params, motion.phase) + noise(params.seed, row, 0, 0) * params.jitter * params.cellSize;
    const dy = noise(params.seed, row, 0, 1) * params.jitter * params.cellSize;
    const paint = paintAt(input, params.width / 2 + dx,
      (Math.max(0, cellY) + Math.min(params.height, cellY + params.cellSize)) / 2 + dy);
    if (!paint) continue;
    appendRect(frame.primitives, dx, cellY + (params.cellSize - thickness) / 2 + dy,
      params.width, thickness, paint.color, paint.opacity, motion);
  }
}

function generateRays(frame: PatternFrame, input: RenderInput, motion: PatternMotion): void {
  const { params } = input;
  const radius = Math.min(params.width, params.height) / 2;
  const inner = radius * params.innerRadius;
  const bandWidth = (radius - inner) / params.radialBands;
  const step = Math.PI * 2 / params.radialCount;
  for (let band = 0; band < params.radialBands; band++) {
    const start = inner + band * bandWidth;
    const end = start + bandWidth;
    const dx = rowDisplacement(band, params.radialBands, params, motion.phase);
    for (let ray = 0; ray < params.radialCount; ray++) {
      const angle = ray * step + band * params.radialTwist * Math.PI / 180;
      const halfOuter = step * params.lineWidth / 2;
      const halfInner = halfOuter * (1 - params.radialTaper);
      const centerX = params.width / 2 + dx + noise(params.seed, band, ray, 0) * params.jitter * params.cellSize;
      const centerY = params.height / 2 + noise(params.seed, band, ray, 1) * params.jitter * params.cellSize;
      const paint = paintAt(input, centerX + Math.cos(angle) * (start + end) / 2,
        centerY + Math.sin(angle) * (start + end) / 2);
      if (!paint) continue;
      const points = ([
        [centerX + Math.cos(angle - halfInner) * start, centerY + Math.sin(angle - halfInner) * start],
        [centerX + Math.cos(angle - halfOuter) * end, centerY + Math.sin(angle - halfOuter) * end],
        [centerX + Math.cos(angle + halfOuter) * end, centerY + Math.sin(angle + halfOuter) * end],
        [centerX + Math.cos(angle + halfInner) * start, centerY + Math.sin(angle + halfInner) * start],
      ] satisfies Point[]).map(([x, y]) => transformPoint(x, y, motion));
      appendPolygon(frame.primitives, points, paint.color, paint.opacity);
    }
  }
}

function generateRings(frame: PatternFrame, input: RenderInput, motion: PatternMotion): void {
  const { params } = input;
  const radius = Math.min(params.width, params.height) / 2;
  const start = radius * params.innerRadius;
  const bands = Math.ceil((radius - start) / params.cellSize);
  for (let band = 0; band < bands; band++) {
    const middle = start + (band + 0.5) * params.cellSize;
    const outer = middle + params.cellSize * params.lineWidth / 2;
    const inner = Math.max(0, middle - params.cellSize * params.lineWidth / 2);
    const x = params.width / 2 + rowDisplacement(band, bands, params, motion.phase)
      + noise(params.seed, band, 0, 0) * params.jitter * params.cellSize;
    const y = params.height / 2 + noise(params.seed, band, 0, 1) * params.jitter * params.cellSize;
    const paint = paintAt(input, x + Math.min(radius, middle), y);
    if (!paint || outer <= 0) continue;
    frame.primitives.push(annulusPrimitive(x, y, outer, inner, paint.color, paint.opacity, motion));
  }
}

function annulusPrimitive(x: number, y: number, outer: number, inner: number, color: string, opacity: number,
  motion: PatternMotion): PatternPrimitive {
  const [cx, cy] = transformPoint(x, y, motion);
  const [a, b, c, d] = motion.transform;
  const xx = a * a + c * c;
  const yy = b * b + d * d;
  const xy = a * b + c * d;
  const difference = Math.hypot(xx - yy, 2 * xy);
  // Principal axes of A*Aᵀ keep annuli exact even when local rotation + global XY scale creates shear.
  const major = Math.sqrt(Math.max(0, (xx + yy + difference) / 2));
  const minor = Math.sqrt(Math.max(0, (xx + yy - difference) / 2));
  const rotation = Math.atan2(2 * xy, xx - yy) * 90 / Math.PI;
  const halfWidth = outer * Math.hypot(a, c);
  const halfHeight = outer * Math.hypot(b, d);
  const outsideRight = transformPoint(x + outer, y, motion).map(format).join(" ");
  const outsideLeft = transformPoint(x - outer, y, motion).map(format).join(" ");
  const outsideArc = `${format(outer * major)} ${format(outer * minor)} ${format(rotation)} 1 0`;
  let path = `M ${outsideRight} A ${outsideArc} ${outsideLeft} A ${outsideArc} ${outsideRight} Z`;
  if (inner > 0) {
    const insideRight = transformPoint(x + inner, y, motion).map(format).join(" ");
    const insideLeft = transformPoint(x - inner, y, motion).map(format).join(" ");
    const insideArc = `${format(inner * major)} ${format(inner * minor)} ${format(rotation)} 1 1`;
    path += ` M ${insideRight} A ${insideArc} ${insideLeft} A ${insideArc} ${insideRight} Z`;
  }
  return { x: cx - halfWidth, y: cy - halfHeight, width: halfWidth * 2, height: halfHeight * 2,
    path, color, opacity };
}

function paintAt(input: RenderInput, x: number, y: number) {
  const { params } = input;
  const sampled = params.sourceMode === "sample";
  const sample = sampled ? sampleSource(input.source, x, y, params)
    : { red: 1, green: 1, blue: 1, alpha: 1, value: 1 };
  if (sample.alpha <= 0) return null;
  // Tiny interpolation differences must not put mirrored samples in different atlas bins.
  // Procedural fields ignore hidden sampling controls and always use the full signal.
  const value = sampled ? Number(adjustedValue(sample, params).toFixed(12)) : 1;
  const opacity = params.colorMode === "gradient" && sampled ? value * sample.alpha
    : params.colorMode === "source" ? sample.alpha : 1;
  if (opacity <= 0) return null;
  return { sample, value, color: patternColor(sample, value, params), opacity };
}

function patternMotion(params: PatternParams, time: number): PatternMotion {
  if (!Number.isFinite(time)) throw new Error("Animation time must be finite.");
  const phase = Number((((params.animationPhase + time / params.animationDuration) % 1 + 1) % 1).toFixed(12)) % 1;
  const scale = params.animation === "pulse" ? 1 + params.animationAmount * Math.sin(phase * Math.PI * 2) : 1;
  const rotation = params.rotation + (params.animation === "rotate" ? 360 * phase : 0);
  const angle = rotation * Math.PI / 180;
  const cosine = Number(Math.cos(angle).toFixed(12));
  const sine = Number(Math.sin(angle).toFixed(12));
  const a = cosine * scale * params.patternScaleX;
  const b = sine * scale * params.patternScaleX;
  const c = -sine * scale * params.patternScaleY;
  const d = cosine * scale * params.patternScaleY;
  return { phase, transform: [a, b, c, d,
    params.width / 2 + params.patternOffsetX - a * params.width / 2 - c * params.height / 2,
    params.height / 2 + params.patternOffsetY - b * params.width / 2 - d * params.height / 2] };
}

function transformPoint(x: number, y: number, motion: PatternMotion): Point {
  const [a, b, c, d, e, f] = motion.transform;
  return [a * x + c * y + e, b * x + d * y + f];
}

function appendRect(primitives: PatternPrimitive[], x: number, y: number, width: number, height: number,
  color: string, opacity: number, motion: PatternMotion): void {
  if (width <= 0 || height <= 0 || opacity <= 0) return;
  const [a, b, c, d] = motion.transform;
  if (b === 0 && c === 0 && a >= 0 && d >= 0) {
    const [left, top] = transformPoint(x, y, motion);
    primitives.push({ x: left, y: top, width: width * a, height: height * d, color, opacity });
    return;
  }
  appendPolygon(primitives, [transformPoint(x, y, motion), transformPoint(x + width, y, motion),
    transformPoint(x + width, y + height, motion), transformPoint(x, y + height, motion)], color, opacity);
}

function appendPolygon(primitives: PatternPrimitive[], points: Point[], color: string, opacity: number): void {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  primitives.push({ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, points, color, opacity });
}

function rowDisplacement(row: number, rows: number, params: PatternParams, phase: number, animated = true): number {
  const stagger = params.rowShiftMode === "alternating" ? (row % 2 === 0 ? -0.5 : 0.5) * params.rowShift
    : Math.sin(row * Math.PI * 2 / 7) * params.rowShift;
  const wave = animated && params.animation === "wave" ? Math.sin((phase + row / Math.max(1, rows)) * Math.PI * 2)
    * params.animationAmount * params.cellSize : 0;
  return stagger + wave;
}

function noise(seed: number, row: number, column: number, axis: number): number {
  let state = (seed | 0) ^ Math.imul(row + 1, 0x9e3779b1) ^ Math.imul(column + 1, 0x85ebca6b) ^ Math.imul(axis + 1, 0xc2b2ae35);
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  return ((state ^ (state >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
}

// Paint stays in output coordinates, independent of the composition transform, in both renderers.
function gradientFor(params: PatternParams): PatternGradient {
  const centerX = params.width / 2 + params.gradientCenterX * params.width / 2;
  const centerY = params.height / 2 + params.gradientCenterY * params.height / 2;
  const angle = params.gradientAngle * Math.PI / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const halfSpan = (Math.abs(dx) * params.width + Math.abs(dy) * params.height) * params.gradientSpan / 2;
  return {
    type: params.gradientType,
    x1: params.gradientType === "radial" ? centerX : centerX - dx * halfSpan,
    y1: params.gradientType === "radial" ? centerY : centerY - dy * halfSpan,
    x2: params.gradientType === "radial" ? centerX : centerX + dx * halfSpan,
    y2: params.gradientType === "radial" ? centerY : centerY + dy * halfSpan,
    radius: Math.hypot(params.width, params.height) * params.gradientSpan / 2,
    start: params.gradientStart, end: params.gradientEnd,
  };
}

export function patternToSvg(input: RenderInput): string {
  const frame = generatePattern(input);
  const project = projectFor(input);
  const metadata = escapeXml(JSON.stringify({
    ...project,
    time: input.time ?? 0,
    evaluatedTime: input.params.animationTime + (input.time ?? 0),
    source: {
      name: project.source.name,
      fingerprint: project.source.fingerprint,
      usesAlpha: project.source.usesAlpha,
      ...(project.source.kind ? { kind: project.source.kind, size: project.source.size } : {}),
      ...(project.source.vectorMask ? { vectorMask: project.source.vectorMask } : {}),
    },
  }));
  const definitions: string[] = [];
  const shapes = frameToSvg(frame, "", definitions);
  const defs = definitions.length > 0 ? `  <defs>${definitions.join("")}</defs>\n` : "";
  const background = frame.background
    ? `  <rect width="${frame.width}" height="${frame.height}" fill="${escapeXml(frame.background)}"/>\n`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frame.width} ${frame.height}" width="${frame.width}" height="${frame.height}">\n  <metadata>${metadata}</metadata>\n${defs}${background}${shapes}\n</svg>\n`;
}

function frameToSvg(frame: PatternFrame, prefix: string, definitions: string[]): string {
  const gradientId = `${prefix}pattern-gradient`;
  if (frame.gradient) {
    const gradient = frame.gradient;
    const stops = `<stop offset="0" stop-color="${escapeXml(gradient.start)}"/><stop offset="1" stop-color="${escapeXml(gradient.end)}"/>`;
    definitions.push(gradient.type === "linear"
      ? `<linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="${format(gradient.x1)}" y1="${format(gradient.y1)}" x2="${format(gradient.x2)}" y2="${format(gradient.y2)}">${stops}</linearGradient>`
      : `<radialGradient id="${gradientId}" gradientUnits="userSpaceOnUse" cx="${format(gradient.x2)}" cy="${format(gradient.y2)}" r="${format(gradient.radius)}" fx="${format(gradient.x1)}" fy="${format(gradient.y1)}">${stops}</radialGradient>`);
  }
  const masks = [...(frame.mask ? [frame.mask] : []), ...(frame.masks ?? [])];
  const maskIds = masks.map((mask, index) => {
    const id = `${prefix}source-mask${index === 0 ? "" : `-${index}`}`;
    const paths = mask.paths.map((path) => `<path d="${escapeXml(path.d)}" transform="matrix(${path.transform.map(format).join(" ")})" fill="white" fill-rule="${path.fillRule}"/>`).join("");
    definitions.push(`<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${frame.width}" height="${frame.height}" mask-type="alpha">${paths}</mask>`);
    return id;
  });
  const elements: string[] = [];
  for (const shape of frame.primitives) {
    if (shape.opacity <= 0 || shape.width <= 0 || shape.height <= 0) continue;
    const color = shape.color === "url(#pattern-gradient)" ? `url(#${gradientId})` : shape.color;
    const paint = `fill="${escapeXml(color)}"${shape.opacity < 1 ? ` opacity="${format(shape.opacity)}"` : ""}${shape.entityId ? ` data-cell-id="${escapeXml(shape.entityId)}"` : ""}`;
    if (shape.path) elements.push(`  <path d="${escapeXml(shape.path)}" ${paint}/>`);
    else if (shape.points) elements.push(`  <polygon points="${shape.points.map(([x, y]) => `${format(x)},${format(y)}`).join(" ")}" ${paint}/>`);
    else elements.push(`  <rect x="${format(shape.x)}" y="${format(shape.y)}" width="${format(shape.width)}" height="${format(shape.height)}" ${paint}/>`);
  }
  for (const [index, layer] of (frame.layers ?? []).entries()) {
    elements.push(`  <g data-layer="${index}">\n${frameToSvg(layer, `${prefix}layer-${index}-`, definitions)}\n  </g>`);
  }
  let shapes = elements.join("\n");
  for (const id of maskIds) shapes = `  <g mask="url(#${id})">\n${shapes}\n  </g>`;
  return shapes;
}

export function projectFor(input: RenderInput): PatternProject {
  const { params, source } = input;
  const canonicalParams = canonicalizePatternParams(params);
  return {
    app: "Taxis",
    version: 3,
    fingerprint: projectFingerprint(canonicalParams, source),
    params: canonicalParams,
    source: {
      name: source.name,
      fingerprint: source.fingerprint,
      usesAlpha: source.usesAlpha,
      ...(source.dataUrl ? { dataUrl: source.dataUrl } : {}),
      ...(source.kind ? { kind: source.kind, size: source.width } : {}),
      ...(source.vectorMask ? { vectorMask: parseVectorMask(source.vectorMask) } : {}),
    },
  };
}

export function adjustedValue(sample: SourceSample, params: PatternParams): number {
  if (sample.alpha <= 0) return 0;
  const initial = params.invert ? 1 - sample.value : sample.value;
  return clamp01((initial - 0.5) * params.contrast + 0.5 + params.luminanceBias * 0.35);
}

function patternColor(sample: SourceSample, value: number, params: PatternParams): string {
  if (params.colorMode === "gradient") return "url(#pattern-gradient)";
  if (params.colorMode === "source") return rgb(sample.red, sample.green, sample.blue);
  if (params.colorMode === "monochrome") {
    const [red, green, blue] = hexToRgb(params.monoColor);
    return rgb(red * value, green * value, blue * value);
  }
  const index = Math.min(params.colorCount - 1, Math.floor(value * params.colorCount));
  return params.colors[index] ?? params.colors[0];
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function rgb(red: number, green: number, blue: number): string {
  return `rgb(${Math.round(clamp01(red) * 255)} ${Math.round(clamp01(green) * 255)} ${Math.round(clamp01(blue) * 255)})`;
}

function format(value: number): string {
  return Number(value.toFixed(12)).toString();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
