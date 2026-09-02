# Orb Lab

Orb Lab turns PNG, JPEG, WebP, AVIF, and SVG files into animated sliced-band,
dot-grid, or hybrid orb forms. Image decoding, rendering, audio analysis, and
exports stay in the browser.

## Run

```bash
bun install
bun run dev
```

Open the URL printed in the terminal. The development server prefers
`http://localhost:3000` and automatically uses the next available port when it
is occupied. Set `PORT` to require a specific port.

To develop from another device on the same Tailscale network, run:

```bash
bun run dev:tailnet
```

Open the URL printed in the terminal (currently
`http://100.124.41.46:5173`) from another tailnet device. The server binds only
to this machine's Tailscale address, and Bun's live reload works over the same
connection.

If a browser requires a localhost secure context for WebGPU or microphone
access, run this on the viewing computer while `dev:tailnet` is running:

```bash
ssh -N -L 15173:100.124.41.46:5173 gilrodrigues@server
```

Then open `http://localhost:15173` there. The SSH connection still travels over
the tailnet, and live reload continues through the forwarded port.

For a production bundle:

```bash
bun run check
bun run test:e2e
bun run preview
```

## How it works

- A deterministic TypeScript model samples source alpha when transparency is
  present and luminance otherwise. The same parameters drive SVG geometry,
  Canvas fallback/export, and the live shader.
- vgpu manages the WebGPU surface, mask texture, uniforms, and frame loop. The
  fullscreen WGSL effect renders at up to the display refresh rate. Canvas 2D
  activates automatically when WebGPU is unavailable.
- Undo/redo, presets, seeded randomization, per-parameter locks, reset, pointer
  response, and optional local microphone analysis are built in.
- SVG exports real editable circles and rounded rectangles. PNG is transparent.
  WebM uses `MediaRecorder`; MP4 lazy-loads `mp4-muxer` and uses WebCodecs. Video
  frames are generated over one exact animation period for seamless playback.

Chrome or Edge is recommended for WebGPU and MP4 export. Other current browsers
use the Canvas fallback and expose the export formats their media APIs support.

## Project layout

```text
src/model/    deterministic parameters, masks, and geometry
src/render/   vgpu/WGSL and Canvas renderers
src/export/   local SVG, PNG, JSON, WebM, and MP4 paths
src/components/ interface and controls
tests/        geometry, loop, format, preset, and shader contracts
```

No backend, telemetry, or upload endpoint is included.
