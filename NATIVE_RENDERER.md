# Native renderer

Taxis uses the actual [Kor](https://github.com/gildrb/kor) document API and [Archetypon](https://github.com/gildrb/archetypon) renderer/PNG encoder. The deterministic scene evaluator generates editable SVG. Kor parses and retains it; Archetypon produces RGBA and PNG bytes. Canvas only displays RGBA with `putImageData`.

## Artifact and reproduction

- `native/renderer.lock.json` pins both source commits, source-archive hashes, Zig version/flags, bridge hash, and artifact hash.
- `native/bridge.c` handles the C ownership/ABI boundary. `src/render/native.ts` initializes the standalone module and exposes owned documents and copied output bytes.
- `public/renderer/kor.wasm` is served locally and included in normal static builds. The module has no runtime imports, WASI syscall stubs, or cross-origin-isolation requirement.

```sh
bun run check:native
ZIG=/path/to/pinned/zig bun run build:native
```

Rebuilding fetches only pinned upstream archives and verifies their hashes. It does not require sibling checkouts. `--update` is an explicit reviewed rebuild operation, not part of normal deployment. Normal production builds verify the existing artifact before emitting assets.

## Boundaries

The wrapper rejects invalid dimensions, unsupported input, disposed documents, and native errors. Native resources have explicit scene, path, surface, and work budgets; exceeding them fails rather than selecting another renderer or producing partial artwork. The current 2× supersampling policy limits raster output to 4,194,304 pixels, such as 2048×2048. A 4096 per-axis scene parameter limit does not guarantee that every raster output fits these budgets.

Taxis-generated radial gradients use the supported numeric user-space subset. Unsupported SVG constructs, including text, external resources, and nested mask references inside mask content, are rejected. Native-supported SVG outside the editor's safe filled-path mask subset can still supply raster samples. Browser SVG viewers can use different antialiasing from Archetypon; compare geometry and paint rather than assuming byte-identical edge pixels. Taxis preview and native PNG use the same rasterizer.

## Licensing

Kor includes an MIT license, reproduced in `public/renderer/LICENSES.txt`. Archetypon has no license file in the reviewed upstream checkout. Its provenance is recorded, but no general third-party license grant is inferred or invented. This repository-owner-directed integration does not establish redistribution terms for others.
