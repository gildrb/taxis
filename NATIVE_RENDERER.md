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

The wrapper rejects invalid dimensions, unsupported input, disposed documents, and native errors. Native resources have explicit scene, path, surface, and work budgets; exceeding them fails rather than selecting another renderer or producing partial artwork. The current 2× supersampling policy limits raster output to 4,194,304 pixels, such as 2048×2048. The default 1500×1500 canvas fits. SVG serialization does not rasterize and can exceed that limit: export accepts at most 16,777,216 pixels, with scene dimensions capped at 4096 per axis. Geometry budgets still apply: 250,000 candidate cells, 25,000 shapes or mask paths, and 4 million repeated mask-path characters. The native wrapper accepts at most 32 MiB of SVG source. Passing the dimension checks does not guarantee that every scene fits native work budgets.

Taxis-generated radial gradients use the supported numeric user-space subset. Unsupported SVG constructs, including text, external resources, and nested mask references inside mask content, are rejected. Native-supported SVG outside the editor's safe filled-path mask subset can still supply raster samples. Browser SVG viewers can use different antialiasing from Archetypon; compare geometry and paint rather than assuming byte-identical edge pixels. Taxis preview and native PNG use the same rasterizer.

## Keyframe evaluation

Motion 13.2.0 supplies pure numeric `transform` and `cubicBezier` interpolation before SVG generation. It does not replace Kor/Archetypon rendering. Whole-cell tracks evaluate explicit elapsed seconds in both Bun and the browser; their local offsets, scale, rotation, and opacity are included in editable exported geometry and paint. Timeline UI animation and the selection overlay are not export inputs. Track validation bounds allocations to 8,192 tracks, 256 keys per track, and 16,384 total keys.

## Image and video encoding

SVG, RGBA, and PNG use the same standalone backend in browsers and Bun. JPEG/WebP encode native RGBA through browser image codecs; they do not introduce a second vector renderer. MP4/WebM export renders fixed scene times and sends copied RGBA to WebCodecs through Mediabunny. UI video export with authored cell tracks starts at zero and defaults to the full keyframe clip; the API keeps its explicit input cursor/time. No MediaRecorder, screen capture, animated-image substitute, runtime encoding server, or external CLI is used. JPEG and video composite transparency onto an explicit background.

Browser video export requires HTTPS or localhost and an encoder supported at the requested dimensions. HTTP Tailnet addresses are not secure contexts. MP4 probes AVC/H.264 first, then VP9; VP9-in-MP4 is valid but less compatible with older players. WebM probes VP9 then VP8. Capability checks and export failures report real limitations rather than replacing the requested format. Video has the same raster pixel cap, plus 1–60 FPS, at most 60 seconds/1,800 whole frames, and 128 MiB encoded output. See [SCENE_API.md](SCENE_API.md) for API options.

## Licensing

Kor includes an MIT license, reproduced in `public/renderer/LICENSES.txt`. Archetypon has no license file in the reviewed upstream checkout. Its provenance is recorded, but no general third-party license grant is inferred or invented. This repository-owner-directed integration does not establish redistribution terms for others.
