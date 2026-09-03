import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { unpluginFactory, type UserOptions } from "@stylexjs/unplugin";

const root = resolve(import.meta.dir, "..");
const styleDirectory = resolve(root, ".stylex");
const cssOutput = resolve(styleDirectory, `stylex.${process.pid}.dev.css`);
const temporaryOutput = `${cssOutput}.tmp`;
mkdirSync(styleDirectory, { recursive: true });

for (const name of readdirSync(styleDirectory)) {
  const match = /^stylex\.(\d+)\.dev\.css(?:\.tmp)?$/.exec(name);
  if (!match?.[1] || Number(match[1]) === process.pid) continue;
  try {
    process.kill(Number(match[1]), 0);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") {
      rmSync(resolve(styleDirectory, name), { force: true });
    }
  }
}

const cleanCssOutput = () => {
  rmSync(cssOutput, { force: true });
  rmSync(temporaryOutput, { force: true });
};
process.once("exit", cleanCssOutput);
process.once("SIGINT", () => { cleanCssOutput(); process.exit(130); });
process.once("SIGTERM", () => { cleanCssOutput(); process.exit(143); });

const options: Partial<UserOptions> = {
  dev: true,
  runtimeInjection: false,
  importSources: ["@stylexjs/stylex"],
  enableMediaQueryOrder: false,
  useCSSLayers: { before: ["reset"] },
  unstable_moduleResolution: { type: "commonJS", rootDir: root },
};
const plugin = unpluginFactory(options, { framework: "bun" }) as any;
const loaders: Record<string, "js" | "jsx" | "ts" | "tsx"> = {
  ".js": "js",
  ".jsx": "jsx",
  ".ts": "ts",
  ".tsx": "tsx",
};
let started = false;
let lastCss: string | undefined;
let writeQueue = Promise.resolve();

function writeCollectedCss(): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    const css = plugin.__stylexCollectCss?.() || "";
    const next = css ? `:root { --stylex-injection: 0; }
${css}` : ":root { --stylex-injection: 0; }";
    if (next === lastCss) return;
    await mkdir(styleDirectory, { recursive: true });
    await writeFile(temporaryOutput, next, "utf8");
    await rename(temporaryOutput, cssOutput);
    lastCss = next;
  });
  return writeQueue;
}

export default {
  name: "pattern-lab-stylex-bun",
  setup(build: any) {
    build.onStart(async () => {
      // Bun reuses transformed modules between incremental page builds. Resetting
      // StyleX on every build drops rules for those cached modules.
      if (!started) {
        plugin.buildStart?.call(plugin);
        started = true;
      }
      await writeCollectedCss();
    });
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args: { path: string }) => {
      const code = await Bun.file(args.path).text();
      const result = plugin.transform ? await plugin.transform.call(plugin, code, args.path) : null;
      await writeCollectedCss();
      return {
        contents: result?.code ?? code,
        loader: loaders[extname(args.path)] ?? "js",
      };
    });
    build.onEnd(async () => {
      await plugin.buildEnd?.call(plugin);
      await writeCollectedCss();
    });
  },
};
