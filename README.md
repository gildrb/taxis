# Taxis

Taxis is a programmable, deterministic vector-pattern system. The visual editor and agent API share the same scene model. Start with a generated sphere or import PNG, JPEG, WebP, AVIF, or supported SVG artwork. Nothing is uploaded.

## Whole cells

Enable **Use cells** to make each sampling slot one complete, editable shape.

- **Cell shape** selects a square, circle, triangle, line, diamond, hexagon, octagon, or regular polygon for every individual cell. It does not cut the whole pattern into that shape.
- **Cell Size** sets the slot size. **Gap X / Y** increases the distance between these individual slots. **Cell padding** insets the shape inside its slot without moving the centers.
- Cells fit a centered grid. Source and pattern boundaries select whole cells by their centers; they do not slice cells. Cells that cross a repeat or canvas boundary after transforms are omitted completely.
- **Cell rotation** fits the rotated shape inside its slot. Motif scale must be at most 1 in this mode. Threshold controls which center samples include a cell.
- **Repeat pattern** is separate: it copies complete pattern fields. Its repeat gaps and individual-repeat overrides do not control the small-cell spacing.

Dropdowns are in-page, product-styled menus with keyboard selection and dismissal, not operating-system popups.

## Create and transform

With Use cells off, choose horizontal, vertical, or shape rasters, uniform stripes, radial rays, or concentric rings. Continuous modes can crop edges and use exact vector clipping.

**Position X / Y** moves the complete pattern in pixels. **Scale X / Y** stretches geometry and spacing independently. Scale and rotation use the canvas center, then position moves that center. Defaults have no hidden stagger, rotation, or jitter; explicit seeded jitter is repeatable.

**Source** has separate fit, scale, position, and rotation. Sample reads image brightness, alpha, and color. Mask uses a supported silhouette; in whole-cell mode it selects complete cells from coverage. Ignore builds a procedural field. **Pattern clip** is an optional whole-pattern boundary, separate from Cell shape. Canvas padding and repeat overrides are under Repeat pattern.

Custom palettes, source color, monochrome, and linear/radial gradients are supported. Gradients stay in canvas coordinates independently of pattern transforms. Use Masked Stripes with filled SVG lettering or Radial Rays for segmented radial designs. Convert text to paths first. Unsupported native SVG features fail explicitly; supported artwork outside the safe vector-mask subset can still supply raster samples.

## Motion and export

Choose Pulse, Rotate, or Wave, then press Play. Restoring a scene never autoplays. Phase and elapsed time evaluate deterministically. Hidden tabs suspend playback, and playback does not fill undo or browser history.

PNG and SVG export the displayed frame and pause playback. SVG retains editable shapes, paths, gradients, and groups, not screenshots. Exports are still frames, not animated SVG/video. Project JSON saves the scene and source data. URLs store settings and source identity; custom images must be reopened after reload.

Kor and Archetypon run through standalone WebAssembly for SVG rendering and PNG encoding. Canvas only presents their RGBA output; there is no parallel Canvas vector renderer. Browser agents and headless Bun can use the same backend. See [SCENE_API.md](SCENE_API.md). There are no legacy scene migrations.

## Run and verify

Use Bun 1.4.0. Normal builds use the checked-in, hash-verified WebAssembly artifact; no C compiler or sibling checkout is required.

```sh
bun install
bun run dev
```

```sh
bun run check
bun run test:e2e
```

`bun run check:native` verifies the artifact and runs a real native SVG/RGBA/PNG smoke test. `bun run build:native` reproduces it from the compiler and source revisions in `native/renderer.lock.json`; set `ZIG` to the pinned compiler if needed. See [NATIVE_RENDERER.md](NATIVE_RENDERER.md) for provenance, rebuilding, and resource limits.
