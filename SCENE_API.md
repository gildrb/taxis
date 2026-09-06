# Taxis scene interface

The visual editor and agents use the same parameter model, scene history, geometry evaluator, and SVG exporter. There is one current scene schema. Taxis does not migrate older schemas.

## In a browser

`window.taxis` is available after the editor mounts. Use it directly in browser automation or the console. No clicks or DOM selectors are required.

```js
const api = window.taxis;
const schema = api.schema;
const scene = api.setParams({
  preset: "radial",
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
const frame = api.evaluate(1); // Explicit seconds from the scene's phase.
const svg = api.svg(1);       // Editable vectors, validated/serialized by Kor.
const rgba = api.render(1);   // {width, height, stride, pixels}; native RGBA copy.
const png = api.png(1);       // Archetypon PNG bytes for exactly that time.
const saved = api.getScene(); // Complete restorable scene, including source data.
await api.setScene(saved);
```

- `schema` describes every parameter's default, type, range, precision, or choices. `setParams(patch)` validates an atomic edit, updates the editor and its URL, and records one undo step. Unknown names and invalid values throw without changing the scene.
- `getScene()` returns an independent project snapshot. `setScene(scene)` restores it, validates its source and fingerprint, and returns the restored scene. It also accepts a parameter object to replace settings while retaining the source. Both scene and source writes are immediately observable through the API; React updates the visible controls on its next render.
- `setSource(file)` accepts a browser `File` containing PNG, JPEG, WebP, AVIF, or SVG. It uses the same importer and centered source placement as the UI. For SVG masks, supply standalone filled vector paths or supported shapes, not text, strokes, linked resources, filters, or CSS effects.
- `evaluate(time = 0)` returns the vector primitive frame. `svg(time = 0)` returns editable SVG with the scene and explicit frame time in metadata. `render(time = 0)` returns owned native RGBA bytes and dimensions; `png(time = 0)` returns owned PNG bytes. `renderer` identifies `Kor/Archetypon`. These reads do not depend on the running preview clock or mutate editor state. Same scene plus same time produces the same output.
- Restoring a scene never starts playback. In-editor playback is only a preview clock; exported still frames pause at the displayed phase. Set `animationPhase` explicitly when automating edits during playback.

Keep complete scene JSON when a source is custom. A URL stores parameters and source identity, not image bytes. Generated-source URLs reproduce independently; custom-source URLs require the matching source file. Projects contain embedded pixels and safe vector geometry.

## Without a browser

The public TypeScript entry point is `src/api.ts`. Its geometry, schema, parameter parser, generated sources, and SVG exporter run directly in Bun. The same modules power the UI.

```ts
import { createRadialSource, parsePreset, patternToSvg } from "./src/api";

const input = {
  params: parsePreset({
    preset: "radial",
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

`cellShape` changes every small cell, not the outline of the field. It accepts square, circle, triangle, line, diamond, hexagon, octagon, or polygon (`cellSides` sets polygon sides). Use cells is off by default and explicitly replaces the continuous/atlas generator while enabled.

Centers are separated by `cellSize + cellGapX/Y`. Floor-fitting keeps the lattice centered without partial edge slots. Padding and motif scale change each shape, not the pitch; motif scale must be at most 1 in whole-cell mode. Source coverage and `maskShape` select complete cells by center. No spatial masks are emitted in whole-cell frames. Local repeat transforms and global canvas transforms can omit complete out-of-bounds cells, but never leave fragments. Scene/time evaluation stays deterministic.

## Pattern clips and full-pattern repeats

With Use cells off, built-in pattern clips are vector geometry, not image assets. `maskShape` accepts `none`, `circle`, `triangle`, `square`, `octagon`, or `polygon`. `maskSides` sets polygon sides. `maskScale` and `maskRotation` transform the mask independently of the pattern inside it. A built-in mask intersects an SVG source mask when both are enabled.

```js
api.setParams({
  preset: "stripes",
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
