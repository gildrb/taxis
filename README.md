# Taxis

Taxis is a programmable, deterministic vector-pattern system. The visual editor and agent API share the same scene model. Start with a generated sphere or import PNG, JPEG, WebP, AVIF, or supported SVG artwork. Nothing is uploaded.

## Whole cells

New scenes use a **1500 × 1500** canvas with **Use cells** enabled. Each sampling slot is one complete, editable shape.

- **Cell shape** selects a square, circle, triangle, line, diamond, hexagon, octagon, or regular polygon for every individual cell. It does not cut the whole pattern into that shape.
- **Cell Size** sets the slot size. **Gap X / Y** increases the distance between these individual slots. **Cell padding** insets the shape inside its slot without moving the centers.
- Cells fit a centered grid. Source and pattern boundaries select whole cells by their centers; they do not slice cells. Cells that cross a repeat or canvas boundary after transforms are omitted completely.
- **Cell rotation** fits the rotated shape inside its slot. Motif scale must be at most 1 in this mode. Threshold controls which center samples include a cell.
- **Repeat pattern** is separate: it copies complete pattern fields. Its repeat gaps and individual-repeat overrides do not control the small-cell spacing.

The editor uses restrained dark grays with a clear visual hierarchy and self-hosted Inter at a minimum of 14 px. Its compact layout keeps Layers and Properties headers aligned. Dropdowns use in-page menus with keyboard selection and dismissal. Export opens a white dialog.

## Create and transform

With Use cells off, choose horizontal, vertical, or shape rasters, uniform stripes, radial rays, or concentric rings. Continuous modes can crop edges and use exact vector clipping.

**Position X / Y** moves the complete pattern in pixels. **Scale X / Y** stretches geometry and spacing independently. Scale and rotation use the canvas center, then position moves that center. Defaults have no hidden stagger, rotation, or jitter; explicit seeded jitter is repeatable.

**Source** has separate fit, scale, position, and rotation. Sample reads image brightness, alpha, and color. Mask uses a supported silhouette; in whole-cell mode it selects complete cells from coverage. Ignore builds a procedural field. **Pattern clip** is an optional whole-pattern boundary, separate from Cell shape. Canvas padding and repeat overrides are under Repeat pattern.

Custom palettes, source color, monochrome, and linear/radial gradients are supported. Gradients stay in canvas coordinates independently of pattern transforms. Use Masked Stripes with filled SVG lettering or Radial Rays for segmented radial designs. Convert text to paths first. Unsupported native SVG features fail explicitly; supported artwork outside the safe vector-mask subset can still supply raster samples.

## Motion and export

In whole-cell mode, Pulse scales each cell around its own center, Rotate turns each cell locally, and Wave displaces cells along X or Y. Wave defaults to column-based phase staggering, so neighboring columns move at different phases. Stable procedural cell IDs support independent animation overrides through the API; changing visibility does not renumber cells.

Open the optional **Timeline** to author keys for all cells or the selected cell. It starts closed unless restored from a link. Click a cell on the canvas or use the focused canvas’s arrow keys to select it; the selection outline is editor-only and never exported. Tracks control local X/Y offsets, scale, rotation, and opacity, with outgoing cubic Bézier easing. Motion evaluates the same keys in the editor, headless API, and exports.

Press Play to preview. Restoring a scene never autoplays. `animationTime` stores elapsed seconds in projects and URLs; it does not collapse independent cell durations into one shared phase. Hidden tabs suspend playback. Pausing or exporting captures the current time without adding an undo step for each preview frame.

The white **Export** dialog offers SVG, PNG, JPEG, WebP, MP4, WebM, and Project JSON. Still images use the paused cursor. With authored whole-cell keyframe tracks, UI video export starts at zero and defaults to the full keyframe duration; otherwise video starts at the captured time. SVG retains editable vectors. PNG and WebP retain transparency; JPEG and video flatten it onto the chosen background. Project JSON saves the scene, source data, and animation settings. URLs store settings and source identity; custom images must be reopened after reload.

Video uses fixed-time native frames encoded with WebCodecs and muxed by Mediabunny, not screen recording or an animated image. It requires HTTPS or localhost and a supported browser encoder. An HTTP Tailnet address is not a secure context. MP4 prefers AVC/H.264 and can use genuine VP9-in-MP4 when AVC is unavailable; older players may not support that fallback. WebM uses VP9 or VP8. The dialog reports unavailable formats and codec notes.

Raster output is limited to **4,194,304 pixels**; the default 1500² canvas fits. SVG can exceed that raster limit within the 4096-per-axis schema, 16,777,216-pixel export limit, and geometry budgets. Video accepts 1–60 FPS, at most 60 seconds, and at most 1,800 whole frames, with a 128 MiB output limit. See [SCENE_API.md](SCENE_API.md) for exact options.
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
