# Taxis scene interface

The visual editor and agents use the same parameter model, scene history, geometry evaluator, and SVG exporter. There is one current scene schema. Taxis does not migrate older schemas.

## In a browser

`window.taxis` is available after the editor mounts. Use it directly in browser automation or the console. No clicks or DOM selectors are required.

```js
const api = window.taxis;
const schema = api.schema;
const scene = api.setParams({
  preset: "radial",
  useCells: false, // Select the continuous radial generator.
  sourceMode: "ignore",
  radialCount: 24,
  radialBands: 3,
  radialTwist: 12,
  patternOffsetX: 0,
  patternOffsetY: 0,
  patternScaleX: 0.8,
  patternScaleY: 1.2,
  rotation: 30,
  colorMode: "gradient",
  gradientStart: "#1d1c1a",
  gradientEnd: "#d26442",
  animation: "pulse",
  animationPhase: 0,
  animationDuration: 4,
});
const frame = api.evaluate(1); // One second after the persisted animationTime.
const svg = api.svg(1);       // Editable vectors, validated/serialized by Kor.
const rgba = api.render(1);   // {width, height, stride, pixels}; native RGBA copy.
const png = api.png(1);       // Archetypon PNG bytes for exactly that time.
const video = await api.export({ format: "mp4", duration: 3, fps: 30 }, 1); // Blob; requires browser codec support.
const saved = api.getScene(); // Complete restorable scene, including source data.
await api.setScene(saved);
```

- `schema` describes every parameter's default, type, range, precision, or choices. `setParams(patch)` validates an atomic edit, updates the editor and its URL, and records one undo step. Unknown names and invalid values throw without changing the scene.
- `getScene()` returns an independent project snapshot. `setScene(scene)` restores it, validates its source and fingerprint, and returns the restored scene. It also accepts a parameter object to replace settings while retaining the source. Both scene and source writes are immediately observable through the API; React updates the visible controls on its next render.
- `setSource(file)` accepts a browser `File` containing PNG, JPEG, WebP, AVIF, or SVG. It uses the same importer and centered source placement as the UI. For SVG masks, supply standalone filled vector paths or supported shapes, not text, strokes, linked resources, filters, or CSS effects.
- `evaluate(time = 0)` returns the vector primitive frame. `svg(time = 0)` returns editable SVG with the scene and explicit frame time in metadata. `render(time = 0)` returns owned native RGBA bytes and dimensions; `png(time = 0)` returns owned PNG bytes. `renderer` identifies `Kor/Archetypon`. These reads do not depend on the running preview clock or mutate editor state. Same scene plus same time produces the same output.
- Restoring a scene never starts playback. Evaluation uses `params.animationTime + time` in seconds, then each animation applies its own duration and phase. Browser API reads default to `time = 0`, the persisted time, not the live preview clock. UI pause/export captures the live time in `animationTime`; API `export(options, time)` is a snapshot read and does not pause playback.

Keep complete scene JSON when a source is custom. A URL stores parameters and source identity, not image bytes. Generated-source URLs reproduce independently; custom-source URLs require the matching source file. Projects contain embedded pixels and safe vector geometry.

Scene links keep settings in the query while the full query, including `?`, fits 6,000 characters. Larger settings move to the URL fragment, which is not sent in HTTP requests. Links are limited to 2,000,000 characters; duplicate `settings` values across query/fragment are rejected. If writing a link exceeds a limit, the editor preserves the live scene, warns to export Project JSON, and enables before-unload protection rather than discarding the edit. Use Project JSON for durable storage of oversized scenes.

## Without a browser

The public TypeScript entry point is `src/api.ts`. Its geometry, schema, parameter parser, generated sources, and SVG exporter run directly in Bun. The same modules power the UI.

```ts
import { createRadialSource, parsePreset, patternToSvg } from "./src/api";

const input = {
  params: parsePreset({
    preset: "radial",
    useCells: false,
    sourceMode: "ignore",
    radialCount: 24,
    radialBands: 3,
    radialTwist: 12,
    patternScaleX: 0.8,
    patternScaleY: 1.2,
    rotation: 30,
    animation: "pulse",
    animationDuration: 4,
  }),
  source: createRadialSource(),
  time: 1,
};
await Bun.write("pattern.svg", patternToSvg(input));
```

SVG rasterization and PNG output also work in headless Bun through the same WebAssembly artifact. Browser codecs decode other source image formats; precise raw-SVG mask extraction uses a browser XML parser. The geometry evaluator itself has no React, DOM, frame-rate, pointer-position, or wall-clock dependency. Parsed `VectorMask` geometry can be supplied directly to the pure engine. There is no random seed chosen on the caller's behalf.


Initialize the native backend explicitly. The host chooses where to load the bytes:

```ts
import { createSvgRenderer, renderScene } from "./src/api";

const renderer = await createSvgRenderer(
  await Bun.file("public/renderer/kor.wasm").arrayBuffer(),
);
await Bun.write("pattern.png", renderScene(input, renderer, "png"));
await Bun.write("pattern.svg", renderScene(input, renderer, "svg"));
const raster = renderScene(input, renderer, "rgba");
```

`renderScene` owns and disposes the temporary native document. For repeated sizes of an unchanged SVG, use `renderer.createDocument(svg)` directly, call its `render(width,height)`, `png(width,height)`, or `serialize()` methods, and release it with `dispose()` in `finally`. Its `size` is the SVG viewBox size, or root dimensions when no viewBox is present. Render and PNG results own their bytes; later native calls or disposal do not invalidate them. There is no import-time fetch, filesystem fallback, or second vector renderer.

## Complete individual cells

```js
api.setParams({
  useCells: true,
  cellShape: "triangle",
  cellSize: 32,
  cellGapX: 8,
  cellGapY: 12,
  cellPadding: 2,
  cellRotation: 0,
  cellThreshold: 0.5,
  sourceMode: "sample",
  maskShape: "none",
});
```

`cellShape` changes every small cell, not the outline of the field. It accepts square, circle, triangle, line, diamond, hexagon, octagon, or polygon (`cellSides` sets polygon sides). Use cells is on by default, with a 1500 × 1500 canvas. It replaces the continuous/atlas generator while enabled.

Centers are separated by `cellSize + cellGapX/Y`. Floor-fitting keeps the lattice centered without partial edge slots. Padding and motif scale change each shape, not the pitch; motif scale must be at most 1 in whole-cell mode. Source coverage and `maskShape` select complete cells by center. No spatial masks are emitted in whole-cell frames. Local repeat transforms and global canvas transforms can omit complete out-of-bounds cells, but never leave fragments. Scene/time evaluation stays deterministic.

## Cell entities and independent motion

Whole-cell frames expose a flat root `entities` list, including hidden cells. Each `CellEntity` has `id`, `repeatIndex`, `row`, `column`, output-space `rest` and `pose`, `selected`, `visible`, `hiddenReason`, and `primitive`. IDs use `cell:<repeatIndex>:<row>:<column>` rest-grid addresses. They remain stable across time and visibility changes, not arbitrary changes to grid topology. `selected` means selected by source/clip coverage, not UI selection. Visible primitives carry `entityId`; selected cells retain complete posed geometry even when bounds hide them.

```js
api.setParams({ useCells: true, sourceMode: "ignore", animation: "wave",
  animationAxis: "y", animationStaggerBy: "column", animationStagger: 0.1,
  animationDuration: 4, animationTime: 1.25 });
const cell = api.evaluate().entities.find(entity => entity.visible);
if (cell) api.setParams({ cellAnimations: [{ id: cell.id,
  animation: "rotate", animationDuration: 2, animationPhase: 0.25 }] });
```

`cellAnimations` is an override array keyed by entity ID; patching it replaces the array. Omitted override fields inherit shared animation settings. Overrides can set `animation`, `animationDuration`, `animationAmount`, `animationPhase`, `animationAxis`, `animationStagger`, and `animationStaggerBy`. Unmatched IDs remain dormant.

Pulse scales and Rotate turns each cell around its own center, not the whole field. Wave displaces along X/Y by a sine wave with amplitude `animationAmount * cellSize`. Its phase offset is `animationStagger` cycles per column, row, or row-major index; `none` disables staggering. Defaults are Y motion and 0.1-cycle column staggering. Source selection and paint sample the rest grid, not animated positions. Bounds omit whole posed cells without cutting them. Continuous modes (`useCells: false`) retain their whole-pattern motion.

## Authored keyframes

Whole-cell scenes can add `keyframeTracks` (default `[]`), `keyframeDuration` (default 4 seconds, range 0.1–60), and `keyframeLoop` (default `false`). Tracks are dormant when `useCells` is false. Each track has a unique `(target, property)` pair, where target is `"all"` or a stable cell ID and property is `x`, `y`, `scale`, `rotation`, or `opacity`.

```js
api.setParams({ useCells: true, keyframeDuration: 4, keyframeLoop: false,
  keyframeTracks: [{ target: "all", property: "y", keyframes: [
    { time: 0, value: 0, easing: [0.42, 0, 0.58, 1] },
    { time: 2, value: -24 },
    { time: 4, value: 0 },
  ] }] });
```

Each key contains seconds `time`, numeric `value`, and optional outgoing `easing: [x1,y1,x2,y2]`. Omitted easing is linear `[0,0,1,1]`. The final key's easing is retained but unused. Bézier X coordinates must be 0–1; Y coordinates may be −2–3. Keys are sorted and canonicalized to six decimals. Times must be unique after rounding and lie within the clip duration. Unknown fields and duplicate target/property pairs fail validation.

Motion's numeric `transform` and `cubicBezier` functions evaluate effective seconds `animationTime + input.time`, not the browser clock or the procedural animation's phase. Non-looping clips clamp time to their endpoints; looping clips wrap at `keyframeDuration`. Tracks hold their first/last value outside their own key range. A per-cell track replaces the `"all"` fallback for that property only. X/Y are local pixel offsets added before static placement, rotation adds degrees, scale multiplies procedural scale, and opacity multiplies source paint opacity. Keyframe scale/opacity outputs are clamped to 0–4/0–1, including easing overshoot. Procedural motion keeps its independent duration.

Authored values allow X/Y −4096–4096 pixels, scale 0–4, rotation −1440–1440 degrees, and opacity 0–1. A scene permits 8,192 tracks, 256 keys per track, and 16,384 keys in total. Replacing `keyframeTracks` replaces the whole array. Zero-opacity cells remain addressable with `hiddenReason: "opacity"`; selection/source sampling still uses the rest grid.

`src/api.ts` exports `createKeyframeEvaluator`, `KEYFRAME_LIMITS`, `KEYFRAME_PROPERTIES`, `KEYFRAME_VALUE_RANGES`, and the `AnimationKeyframe`, `KeyframeEasing`, `KeyframePose`, `KeyframeProperty`, and `KeyframeTrack` types. Validate input with `parsePreset` before compiling an evaluator. Call its result as `evaluateCell(cellId, effectiveSeconds)`; the helper does not add `animationTime` itself. Normal `generatePattern` evaluation does that for you.

The optional Timeline starts closed unless restored from a URL. Canvas click/arrow-key selection addresses stable entities; its SVG selection outline is UI-only, not exported artwork or project geometry. Timeline edits use the same scene tracks as the API.

## Export capabilities and limits

`exportScene(input, renderer, options)` and `window.taxis.export(options, time = 0)` return `Promise<Blob>`. Formats are `svg`, `png`, `jpeg`, `webp`, `mp4`, and `webm`. Project JSON is a UI option, not an `ExportFormat`; serialize `api.getScene()` for that format.

Options include `duration` (default 3 seconds), `fps` (30), `quality` (0–1, default 0.92), opaque `background` (`#RRGGBB`, default scene background), `signal: AbortSignal`, and `onProgress({ completed, total })`. Quality controls JPEG/WebP; video uses a 4 Mbps encoder target. JPEG/video flatten transparency; SVG/PNG/WebP retain it. Export copies the scene before asynchronous work, so later edits do not change an export in progress.

Import `getExportSupport(width, height, fps = 30)` from `src/api.ts` to probe browser image/video encoders. It returns per-format `{ supported, reason?, codec? }`; a supported MP4 entry can include a VP9 compatibility note. This probe does not validate scene geometry or promise every native work budget will fit. `videoFrameCount(duration, fps)` validates integral frame counts without rounding the requested duration or resizing the scene.

UI video export with authored whole-cell tracks starts at zero and defaults its duration to `keyframeDuration`; stills use the paused cursor. This is UI policy only: API export keeps the supplied cursor and relative time, with the normal 3-second default unless `duration` is provided. Video renders at `animationTime + input.time + frameIndex / fps` and encodes real frames with WebCodecs/Mediabunny, independent of preview speed. MP4 prefers AVC/H.264, falling back to VP9 in an actual MP4 container; some older players require H.264. WebM prefers VP9, then VP8. Browser video encoding requires HTTPS or localhost: an HTTP Tailnet origin cannot provide `VideoEncoder`. Codec and size support vary by browser/device. Headless Bun supports native SVG/RGBA/PNG; JPEG/WebP/video need browser encoding APIs.

Raster exports allow at most 4,194,304 pixels. SVG allows up to 16,777,216 pixels, still subject to scene dimensions of at most 4096 per axis and geometry/native budgets. Video allows integer 1–60 FPS, positive duration up to 60 seconds, at most 1,800 frames, and 128 MiB encoded output. `duration * fps` must be a whole number. Exceeding a limit fails explicitly; export never silently reduces size or substitutes a format.

## Pattern clips and full-pattern repeats

With Use cells off, built-in pattern clips are vector geometry, not image assets. `maskShape` accepts `none`, `circle`, `triangle`, `square`, `octagon`, or `polygon`. `maskSides` sets polygon sides. `maskScale` and `maskRotation` transform the mask independently of the pattern inside it. A built-in mask intersects an SVG source mask when both are enabled.

```js
api.setParams({
  preset: "stripes",
  useCells: false,
  sourceMode: "ignore",
  cellSize: 16,
  lineWidth: 0.4,
  maskShape: "triangle",
  maskRotation: 0,
  layoutColumns: 3,
  layoutRows: 2,
  layoutGapX: 24,
  layoutGapY: 40,
  paddingTop: 24,
  paddingRight: 24,
  paddingBottom: 24,
  paddingLeft: 24,
  layoutCells: [
    { index: 1, offsetY: 12, maskRotation: 180 },
    { index: 4, scaleX: 0.8, scaleY: 1.1, rotation: 15, maskShape: "octagon", padding: 8 },
  ],
});
```

Repeat indices in `layoutCells` are zero-based, row-major: `row * layoutColumns + column`. An omitted field inherits the shared setting or a neutral local transform. Overrides stay in the scene when a smaller layout makes their indices inactive. Delete an override to return that form to shared settings. Local offsets let each form alter its spacing without changing its neighbors' coordinates.

Padding and gaps are in pixels. Layout allocates the remaining canvas into equal full-pattern repeat areas; a repeat's optional local padding further insets its content. `layoutGapX/Y` separates these pattern copies; `cellGapX/Y` separates individual small shapes. Primary Position X/Y, Scale X/Y, and Rotation transform the complete assembled layout, so scaling also scales the gaps. The evaluator rejects layouts with no drawable cell area and applies a shared primitive budget across all cells.

A repeated frame has `layers` containing individual vector groups. Continuous modes retain masks; whole-cell mode uses complete primitives without spatial clipping. Each layer has its own paint and clipping data. SVG exports preserve the groups, masks, gradients, and affine transforms rather than flattening them.
