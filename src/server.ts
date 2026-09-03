import index from "../index.dev.html";
import { lstat, realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { resolveAssetPath, resolveExistingAssetPath } from "./server-path";

const production = process.env.NODE_ENV === "production";
const configuredPort = process.env.PORT?.trim() || undefined;
const preferredPort = Number(configuredPort ?? 3000);
const hostname = process.env.TAILDEV_TARGET_HOST?.trim() || process.env.PATTERN_LAB_HOSTNAME?.trim() || "127.0.0.1";
const projectRoot = await realpath(".");

if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65_535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

async function productionRoot(requireAssets = false): Promise<string> {
  let root: string;
  try {
    const entry = await lstat(".preview-current").then(() => ".preview-current").catch(() => "dist");
    root = await realpath(entry);
  } catch {
    throw new Error("Production build is missing. Run “bun run build” before preview.");
  }
  const fromProject = relative(projectRoot, root);
  if (fromProject === ".." || fromProject.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || resolve(projectRoot, fromProject) !== root) {
    throw new Error("The production asset directory resolves outside the project.");
  }
  if (requireAssets) {
    for (const asset of ["/", "/main.js", "/main.css"]) {
      if (!(await resolveExistingAssetPath(root, asset))) {
        throw new Error(`Production asset ${asset === "/" ? "index.html" : asset.slice(1)} is missing or unsafe. Run “bun run build” before preview.`);
      }
    }
  }
  return root;
}

if (production) await productionRoot(true);

function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  const target = etag.replace(/^W\//, "");
  return header.split(",").some((candidate) => {
    const tag = candidate.trim();
    return tag === "*" || tag.replace(/^W\//, "") === target;
  });
}

function matchesIfRange(header: string, modifiedAt: Date): boolean {
  if (header.startsWith('"') || header.startsWith("W/")) return false;
  const validatorTime = Date.parse(header);
  return Number.isFinite(validatorTime) && Math.floor(modifiedAt.getTime() / 1000) <= Math.floor(validatorTime / 1000);
}

async function fileResponse(path: string, request: Request): Promise<Response> {
  const file = Bun.file(path);
  const info = await stat(path);
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = new Headers({
    "Cache-Control": "no-cache",
    "Content-Length": String(info.size),
    "Content-Type": file.type || "application/octet-stream",
    ETag: etag,
    "Last-Modified": info.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  });
  if (matchesEtag(request.headers.get("If-None-Match"), etag)) {
    headers.delete("Content-Length");
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const ifRange = request.headers.get("If-Range");
  if (request.headers.has("Range") && ifRange && !matchesIfRange(ifRange, info.mtime)) {
    return new Response(await file.arrayBuffer(), { status: 200, headers });
  }
  return new Response(file, { headers });
}

const server = (() => {
  if (production) {
    return Bun.serve({
      port: preferredPort,
      hostname,
      async fetch(request) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Method not allowed", {
            status: 405,
            headers: { Allow: "GET, HEAD", "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        const pathname = new URL(request.url).pathname;
        const root = await productionRoot();
        if (!resolveAssetPath(root, pathname)) {
          return new Response("Invalid path", { status: 400, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
        }
        const path = await resolveExistingAssetPath(root, pathname);
        if (path) return fileResponse(path, request);
        if (pathname.startsWith("/public/") || /\.[^/]+$/.test(pathname)) {
          return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
        }
        const fallback = await resolveExistingAssetPath(root, "/");
        if (!fallback) return new Response("Production entry point is unavailable", { status: 503 });
        return fileResponse(fallback, request);
      },
    });
  }

  const lastPort = configuredPort === undefined ? Math.min(preferredPort + 20, 65_535) : preferredPort;
  for (let port = preferredPort; port <= lastPort; port += 1) {
    try {
      return Bun.serve({
        port,
        hostname,
        routes: {
          "/stylex.dev.css": async () => {
            const file = Bun.file(`.stylex/stylex.${process.pid}.dev.css`);
            if (!(await file.exists())) return new Response("StyleX is compiling", { status: 503 });
            return new Response(file, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" } });
          },
          "/*": index,
        },
        development: { hmr: true, console: true },
      });
    } catch (error) {
      const addressInUse = typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
      if (!addressInUse || port === lastPort) throw error;
    }
  }
  throw new Error(`No available port found from ${preferredPort} to ${lastPort}`);
})();

if (configuredPort === undefined && server.port !== preferredPort) {
  console.warn(`Port ${preferredPort} is in use; using port ${server.port} instead.`);
}

console.log(`Pattern Lab running at ${server.url}`);
