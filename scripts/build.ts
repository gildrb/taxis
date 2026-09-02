import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { force: true, recursive: true });
await mkdir("dist", { recursive: true });

const result = await Bun.build({
  entrypoints: ["index.html"],
  outdir: "dist",
  target: "browser",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  minify: true,
  splitting: true,
  sourcemap: "linked",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await cp("public", "dist", { recursive: true });
console.log(`Built ${result.outputs.length} bundled assets in dist/`);
