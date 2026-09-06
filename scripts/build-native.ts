import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createSvgRenderer } from "../src/render/native";

interface SourcePin {
  name: "kor" | "archetypon";
  repository: string;
  revision: string;
  archiveSha256: string;
}
interface RendererLock {
  format: 1;
  compiler: { name: "zig"; version: string; arguments: string[] };
  sources: SourcePin[];
  exports: string[];
  bridge: { path: string; sha256: string };
  artifact: { path: string; sha256: string; bytes: number };
}

const root = resolve(import.meta.dir, "..");
const lockPath = join(root, "native/renderer.lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8")) as RendererLock;
const flags = new Set(process.argv.slice(2));
if ([...flags].some((flag) => flag !== "--check" && flag !== "--update") || flags.size > 1) {
  throw new Error("Use build-native.ts, --check, or --update. Normal app builds use the committed artifact.");
}
if (lock.format !== 1 || lock.compiler.name !== "zig" || lock.sources.length !== 2 ||
    new Set(lock.sources.map((source) => source.name)).size !== 2) {
  throw new Error("Invalid native renderer dependency lock.");
}
for (const source of lock.sources) {
  if (!/^(kor|archetypon)$/.test(source.name) || source.repository !== `gildrb/${source.name}` ||
      !/^[a-f0-9]{40}$/.test(source.revision) || !/^[a-f0-9]{64}$/.test(source.archiveSha256)) {
    throw new Error(`Invalid pinned native source: ${source.name}`);
  }
}
if (lock.bridge.path !== "native/bridge.c" || lock.artifact.path !== "public/renderer/kor.wasm") {
  throw new Error("Unexpected native renderer bridge or artifact path.");
}
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const bridgePath = join(root, lock.bridge.path);
const bridgeHash = hash(await readFile(bridgePath));
if (!flags.has("--update") && bridgeHash !== lock.bridge.sha256) {
  throw new Error("The C bridge changed. Review it and use --update to rebuild the pinned artifact.");
}

async function checkArtifact(bytes: Uint8Array): Promise<void> {
  const renderer = await createSvgRenderer(bytes.slice().buffer);
  const source = '<svg width="2" height="2"><g data-layer="0"><rect width="2" height="2" fill="#ff0000"/></g></svg>';
  const document = renderer.createDocument(source);
  try {
    const raster = document.render(2, 2);
    const png = document.png(2, 2);
    if (raster.pixels.length !== 16 || raster.pixels[0] !== 255 || raster.pixels[3] !== 255 ||
        new TextDecoder().decode(document.serialize()) !== source || png[0] !== 137 || png[1] !== 80) {
      throw new Error("The rebuilt native renderer failed its real RGBA/PNG/serialization smoke test.");
    }
  } finally {
    document.dispose();
  }
}

if (flags.has("--check")) {
  const bytes = await readFile(join(root, lock.artifact.path));
  if (bytes.length !== lock.artifact.bytes || hash(bytes) !== lock.artifact.sha256) {
    throw new Error("The committed native renderer does not match its pinned artifact hash.");
  }
  await checkArtifact(bytes);
  console.log(`Verified ${lock.artifact.path}: ${bytes.length} bytes, no runtime imports.`);
} else {
  const compiler = process.env.ZIG ?? "zig";
  const version = Bun.spawn([compiler, "version"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [versionCode, versionText, versionError] = await Promise.all([
    version.exited, new Response(version.stdout).text(), new Response(version.stderr).text(),
  ]);
  if (versionCode !== 0 || versionText.trim() !== lock.compiler.version) {
    throw new Error(`Rebuilding requires Zig ${lock.compiler.version}. Set ZIG to that compiler. Normal builds need no compiler. ${versionError.trim()}`);
  }
  const cache = join(tmpdir(), "taxis-native-source-cache");
  await mkdir(cache, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "taxis-native-build-"));
  const temporaryArtifact = join(root, `native/.renderer-${process.pid}.wasm`);
  const temporaryLock = join(root, `native/.renderer-${process.pid}.json`);
  try {
    for (const source of lock.sources) {
      const cached = join(cache, `${source.archiveSha256}.tar.gz`);
      let bytes: Uint8Array;
      if (await Bun.file(cached).exists()) {
        bytes = new Uint8Array(await Bun.file(cached).arrayBuffer());
      } else {
        const url = `https://codeload.github.com/${source.repository}/tar.gz/${source.revision}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`Cannot fetch pinned ${source.name}: HTTP ${response.status}`);
        bytes = new Uint8Array(await response.arrayBuffer());
        if (hash(bytes) !== source.archiveSha256) throw new Error(`Pinned ${source.name} archive checksum differs.`);
        const download = join(work, basename(cached));
        await writeFile(download, bytes);
        await rename(download, cached);
      }
      if (hash(bytes) !== source.archiveSha256) throw new Error(`Cached ${source.name} archive checksum differs; remove ${cached} and retry.`);
      const directory = join(work, source.name);
      await mkdir(directory);
      const unpack = Bun.spawn(["tar", "-xzf", cached, "--strip-components=1", "-C", directory], {
        cwd: work, stdout: "inherit", stderr: "inherit",
      });
      if (await unpack.exited !== 0) throw new Error(`Cannot unpack pinned ${source.name}.`);
    }
    const kor = join(work, "kor");
    const archetypon = join(work, "archetypon");
    const sources = (await readdir(join(archetypon, "src"))).filter((name) => name.endsWith(".c")).sort();
    const output = join(work, "kor.wasm");
    const compile = Bun.spawn([
      compiler, ...lock.compiler.arguments, `-I${kor}`, `-I${archetypon}`,
      bridgePath, join(kor, "main.c"), ...sources.map((name) => join(archetypon, "src", name)),
      ...lock.exports.map((name) => `-Wl,--export=${name}`), "-lm", "-o", output,
    ], {
      cwd: work,
      env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: join(cache, `zig-${lock.compiler.version}`), ZIG_LOCAL_CACHE_DIR: join(work, "zig-cache") },
      stdout: "inherit", stderr: "inherit",
    });
    if (await compile.exited !== 0) throw new Error("Native WebAssembly compilation failed.");
    const bytes = await readFile(output);
    await checkArtifact(bytes);
    const digest = hash(bytes);
    if (!flags.has("--update") && (digest !== lock.artifact.sha256 || bytes.length !== lock.artifact.bytes)) {
      throw new Error(`Rebuilt artifact differs from its lock: ${digest}. Review compiler/source changes before --update.`);
    }
    await writeFile(temporaryArtifact, bytes);
    await rename(temporaryArtifact, join(root, lock.artifact.path));
    if (flags.has("--update")) {
      lock.bridge.sha256 = bridgeHash;
      lock.artifact.sha256 = digest;
      lock.artifact.bytes = bytes.length;
      await writeFile(temporaryLock, `${JSON.stringify(lock, null, 2)}\n`);
      await rename(temporaryLock, lockPath);
    }
    console.log(`Built ${basename(lock.artifact.path)}: ${bytes.length} bytes; SHA-256 ${digest}.`);
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(temporaryArtifact, { force: true });
    await rm(temporaryLock, { force: true });
  }
}
