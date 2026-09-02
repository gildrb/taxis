# Pattern Lab

Pattern Lab turns PNG, JPEG, WebP, AVIF, and SVG sources into deterministic line-raster and geometric textures. It runs locally in the browser and exports the exact fixed scene as PNG, editable SVG, or a restorable project file.

## Run

```bash
bun install
bun run dev
```

Open the URL printed in the terminal. The development server prefers `http://localhost:3000` and automatically uses the next free port. Set `PORT` to require one port.

For another device on the same Tailscale network:

```bash
bun run dev:tailnet
```

For production validation:

```bash
bun run check
bun run test:e2e
bun run preview
```

## Workflow

1. Drop or select an image. Pattern Lab preserves its source aspect ratio and chooses alpha for transparent artwork or luminance for opaque images.
2. Pick **Horizontal**, **Vertical**, or **Shapes**. The included Sliced Sphere, Light Raster, and Dark Raster recipes reproduce the three main reference outcomes directly.
3. Adjust cell size, fit, sampling, and palette. Every slider also has an exact numeric input.
4. Export PNG, editable SVG, or **Project** JSON. Project files embed imported source images, parameters, and a stable scene fingerprint.

## Deterministic rendering contract

- One pure evaluator samples fixed output coordinates and emits a `PatternFrame` of rectangles.
- Canvas preview, PNG, and SVG all consume that same frame. There is no second shader implementation with different sampling.
- Time, refresh rate, pointer position, microphone input, and device pixel ratio do not affect the frame.
- Imported opaque images remain luminance sources even when they are not square. Fit is applied during evaluation instead of being baked into a square mask.
- The fingerprint changes when the source pixels or any render parameter changes.

The discrete Bars, Candles, and Shapes motifs follow the public Pattern effect concepts from [basement.studio Shader Lab](https://github.com/basementstudio/shader-lab), licensed under Apache-2.0. Pattern Lab is a focused local editor, not a copy of Shader Lab’s full layer stack or brand.

## Project layout

```text
src/model/       source mapping, validated parameters, pure pattern evaluator
src/render/      Canvas adapter for the evaluated frame
src/components/  full-canvas editor, layers, and contextual properties
src/export/      browser download helpers
scripts/         production bundler
tests/           exact pattern, source-fit, project, server, and browser contracts
```

No backend, telemetry, upload endpoint, randomizer, or implicit animation is included.
