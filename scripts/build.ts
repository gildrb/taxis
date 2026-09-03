import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import stylex from "@stylexjs/unplugin";

const root = resolve(import.meta.dir, "..");
const outdir = resolve(root, "dist");
const staging = resolve(root, `.build-output-${process.pid}`);
const releases = resolve(root, ".build-releases");
const release = resolve(releases, `build-${Date.now()}-${process.pid}`);
const previewLink = resolve(root, ".preview-current");
const temporaryLink = resolve(root, `.preview-link-${process.pid}`);
const standaloneOutput = resolve(root, `.dist-output-${process.pid}`);
const standaloneBackup = resolve(root, `.dist-backup-${process.pid}`);
const lockdir = resolve(root, ".build.lock");

async function acquireBuildLock(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await mkdir(lockdir);
      await writeFile(resolve(lockdir, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      return;
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
      if (await buildLockIsStale()) {
        await rm(lockdir, { force: true, recursive: true });
        continue;
      }
      await delay(50);
    }
  }
  throw new Error("Another Pattern Lab build did not finish within 30 seconds.");
}

async function buildLockIsStale(): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(resolve(lockdir, "owner.json"), "utf8")) as { pid?: unknown; startedAt?: unknown };
    if (typeof owner.pid !== "number" || !Number.isInteger(owner.pid) || owner.pid <= 0 || typeof owner.startedAt !== "number") return true;
    if (Date.now() - owner.startedAt > 300_000 || owner.startedAt > Date.now() + 5_000) return true;
    return !processIsRunning(owner.pid);
  } catch {
    const info = await stat(lockdir).catch(() => undefined);
    return Boolean(info && Date.now() - info.mtimeMs > 2_000);
  }
  return false;
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrorCode(error, "ESRCH");
  }
}

async function pruneAbandonedBuildFiles(): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const match = /^(?:\.build-output-|\.preview-link-|\.dist-output-|\.dist-backup-)(\d+)$/.exec(entry.name);
    if (!match?.[1]) continue;
    const pid = Number(match[1]);
    const path = resolve(root, entry.name);
    const info = await stat(path).catch(() => undefined);
    if (!processIsRunning(pid) || Boolean(info && Date.now() - info.mtimeMs > 86_400_000)) {
      await rm(path, { force: true, recursive: true });
    }
  }
}

async function pruneOldReleases(currentRelease: string): Promise<void> {
  const entries = await readdir(releases, { withFileTypes: true });
  const candidates: Array<{ modified: number; path: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = resolve(releases, entry.name);
    if (path === currentRelease) continue;
    const info = await stat(path);
    candidates.push({ modified: info.mtimeMs, path });
  }
  candidates.sort((first, second) => second.modified - first.modified);
  await Promise.all(candidates.slice(2).map((candidate) => rm(candidate.path, { force: true, recursive: true })));
}

async function rejectPublicSymlinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Public assets cannot be symbolic links: ${path}`);
    if (entry.isDirectory()) await rejectPublicSymlinks(path);
  }
}

function replaceExactlyOnce(source: string, expected: string, replacement: string, label: string): string {
  if (source.split(expected).length !== 2) throw new Error(`Production HTML must contain exactly one ${label} source tag.`);
  return source.replace(expected, replacement);
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

await acquireBuildLock();
let releaseCreated = false;
let published = false;
try {
  await pruneAbandonedBuildFiles();
  await rejectPublicSymlinks(resolve(root, "public"));
  await rm(staging, { force: true, recursive: true });
  await rm(temporaryLink, { force: true, recursive: true });
  await rm(standaloneOutput, { force: true, recursive: true });
  await rm(standaloneBackup, { force: true, recursive: true });
  await mkdir(staging, { recursive: true });
  await mkdir(releases, { recursive: true });

  const stylexPlugin = stylex.esbuild({
    dev: false,
    importSources: ["@stylexjs/stylex"],
    enableMediaQueryOrder: false,
    useCSSLayers: { before: ["reset"] },
    unstable_moduleResolution: { type: "commonJS", rootDir: root },
  });

  // Bun reports metafile outputs relative to outdir. Build from there so the
  // StyleX plugin can locate the emitted stylesheet and append its rules.
  process.chdir(staging);
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [resolve(root, "src/main.tsx")],
      outdir: staging,
      target: "browser",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      minify: true,
      splitting: true,
      metafile: true,
      plugins: [stylexPlugin],
    });
  } finally {
    process.chdir(root);
  }

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Bun production build failed.");
  }

  const sourceHtml = await readFile(resolve(root, "index.html"), "utf8");
  const withCss = replaceExactlyOnce(sourceHtml, '<link rel="stylesheet" href="./src/global.css" />', '<link rel="stylesheet" href="/main.css" />', "global stylesheet");
  const html = replaceExactlyOnce(withCss, '<script type="module" src="./src/main.tsx"></script>', '<script type="module" src="/main.js"></script>', "application script");
  if (/["'](?:\.\/|\/)src\//.test(html)) throw new Error("Production HTML still references a source asset.");
  if (html.split('href="/main.css"').length !== 2 || html.split('src="/main.js"').length !== 2) {
    throw new Error("Production HTML output asset validation failed.");
  }
  await writeFile(resolve(staging, "index.html"), html);
  await cp(resolve(root, "public"), resolve(staging, "public"), { recursive: true });
  for (const asset of ["index.html", "main.js", "main.css"]) {
    if (!(await Bun.file(resolve(staging, asset)).exists())) throw new Error(`Production asset ${asset} was not emitted.`);
  }

  await rename(staging, release);
  releaseCreated = true;
  await symlink(relative(root, release), temporaryLink, "dir");
  const currentPreview = await lstat(previewLink).catch(() => undefined);
  if (currentPreview && !currentPreview.isSymbolicLink()) {
    throw new Error(".preview-current must be a symbolic link managed by the build.");
  }

  await cp(release, standaloneOutput, { recursive: true });
  const currentOutput = await lstat(outdir).catch(() => undefined);
  if (currentOutput) await rename(outdir, standaloneBackup);
  try {
    await rename(standaloneOutput, outdir);
  } catch (error) {
    if (currentOutput) await rename(standaloneBackup, outdir);
    throw error;
  }
  await rm(standaloneBackup, { force: true, recursive: true });

  await rename(temporaryLink, previewLink);
  published = true;
  await pruneOldReleases(await realpath(previewLink));
  console.log(`Built ${result.outputs.length} bundled assets in dist/`);
} finally {
  process.chdir(root);
  await rm(staging, { force: true, recursive: true });
  await rm(temporaryLink, { force: true, recursive: true });
  await rm(standaloneOutput, { force: true, recursive: true });
  await rm(standaloneBackup, { force: true, recursive: true });
  if (releaseCreated && !published) await rm(release, { force: true, recursive: true });
  await rm(lockdir, { force: true, recursive: true });
}
