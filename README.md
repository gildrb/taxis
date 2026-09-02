# Taxis

Pattern Lab turns PNG, JPEG, WebP, AVIF, and SVG sources into deterministic line-raster and geometric textures. It runs locally in the browser and exports the exact fixed scene as PNG, editable SVG, or a restorable project file.

## Run

```bash
bun install
bun run dev
```

Open the Tailnet URL printed in the terminal from any device on the same
Tailscale network. `taildev` discovers the current machine and selects a free
localhost backend port automatically; no hostname, IP address, credential, or
secret is stored in this repository. Live reload uses the same private URL.

`taildev` is installed on NixOS and macOS by the shared Nix configuration. If
it is not installed yet, `bun run dev` automatically runs the public `v0.1.0`
flake. The equivalent standalone command is:

```bash
nix run github:gildrb/taildev -- --port 5173 -- bun --hot src/server.ts
```

For localhost-only development instead, run:

```bash
bun run dev:local
```

The local server prefers `http://localhost:3000` and automatically uses the
next available port when it is occupied.

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
