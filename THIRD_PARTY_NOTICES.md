# Third-party notices

App recipients can read the deployed `/THIRD_PARTY_NOTICES.txt` notice. Its [source file](public/THIRD_PARTY_NOTICES.txt) includes exact dependency source links and the complete Mediabunny MPL-2.0 license.

Taxis's discrete Bars, Candles, and Shapes motif definitions are adapted from the Pattern effect in [basementstudio/shader-lab](https://github.com/basementstudio/shader-lab/tree/6f39a889db74978d93d882643e3cd2073b3666d6).

Copyright basement.studio contributors. Licensed under the Apache License, Version 2.0. A copy of the Apache-2.0 license is included at `LICENSES/Apache-2.0.txt`; the upstream license is also available at <https://github.com/basementstudio/shader-lab/blob/main/LICENSE.md>.

Taxis's editor shell is an independent implementation. It uses the reference application's full-canvas, floating-panel interaction model without copying its branding or source code.

## Native SVG renderer

Taxis uses [Kor](https://github.com/gildrb/kor), backed by [Archetypon](https://github.com/gildrb/archetypon), through WebAssembly. The source revisions, archive checksums, compiler, and artifact checksum are recorded in `native/renderer.lock.json`.

Kor is licensed under MIT; its verified license is reproduced in `public/renderer/LICENSES.txt`. No license file was present in the reviewed Archetypon checkout. Its redistribution terms must be confirmed before publishing a build; no license grant is inferred here.

## Mediabunny

Video encoding and MP4/WebM muxing use [Mediabunny](https://github.com/Vanilagy/mediabunny), currently version 1.55.7 in the installed package and lockfile. Copyright (c) 2026-present, Vanilagy and contributors. The installed `package.json`, `LICENSE`, and source headers identify the **Mozilla Public License 2.0 (MPL-2.0)**, not MIT.

The complete license is in `node_modules/mediabunny/LICENSE` after installation and at <https://www.mozilla.org/MPL/2.0/>. The corresponding published package, including its `src/` source, is available at <https://registry.npmjs.org/mediabunny/-/mediabunny-1.55.7.tgz>. Preserve its notices and provide the covered source under MPL-2.0 when distributing bundled executable code. This notice does not change the licenses of separate Taxis files.

## Inter

The self-hosted `public/fonts/InterVariable.woff2` is the unmodified normal variable font from [Inter v4.1](https://github.com/rsms/inter/tree/v4.1/docs/font-files), with weights 100–900. Copyright (c) 2016 The Inter Project Authors. Licensed under the **SIL Open Font License 1.1**; the full copyright and license are included in `public/fonts/LICENSE.txt`, with provenance in `public/fonts/README.md`. Taxis does not request fonts from a runtime font service.

## Motion and runtime dependencies

Authored cell keyframes use Motion's numeric interpolation; the optional Timeline also uses Motion's React UI helpers. Installed versions and licenses were checked against each package's `package.json` and license file:

- Motion 13.2.0, motion-dom 13.2.0, and motion-utils 13.0.0: MIT; copyright (c) 2024 Motion B.V.
- framer-motion 13.2.0: MIT; copyright (c) 2018 Framer B.V.
- tslib 2.8.1: **0BSD**, not MIT; copyright (c) Microsoft Corporation.

The deployed `/THIRD_PARTY_NOTICES.txt` reproduces their complete license texts and links to each exact published source package. Motion does not replace the native vector renderer, and its UI animation state is not used to encode scene frames.
