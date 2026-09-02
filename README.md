# Taxis

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

