import index from "../index.html";
import { resolveAssetPath } from "./server-path";

const production = process.env.NODE_ENV === "production";
const configuredPort = process.env.PORT;
const preferredPort = Number(configuredPort ?? 3000);
const hostname = process.env.TAILDEV_TARGET_HOST ?? "127.0.0.1";

if (!Number.isInteger(preferredPort) || preferredPort < 0 || preferredPort > 65_535) {
  throw new Error(`Invalid PORT: ${configuredPort}`);
}

const server = (() => {
  if (production) {
    return Bun.serve({
      port: preferredPort,
      hostname,
      async fetch(request) {
        const path = resolveAssetPath("dist", new URL(request.url).pathname);
        if (!path) return new Response("Invalid path", { status: 400 });
        const file = Bun.file(path);
        if (await file.exists()) return new Response(file);
        return new Response(Bun.file("dist/index.html"));
      },
    });
  }

  const lastPort = configuredPort === undefined ? Math.min(preferredPort + 20, 65_535) : preferredPort;
  for (let port = preferredPort; port <= lastPort; port += 1) {
    try {
      return Bun.serve({
        port,
        hostname,
        routes: { "/*": index },
        development: { hmr: true, console: true },
      });
    } catch (error) {
      const addressInUse =
        typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
      if (!addressInUse || port === lastPort) throw error;
    }
  }

  throw new Error(`No available port found from ${preferredPort} to ${lastPort}`);
})();

if (configuredPort === undefined && server.port !== preferredPort) {
  console.warn(`Port ${preferredPort} is in use; using port ${server.port} instead.`);
}

console.log(`Pattern Lab running at ${server.url}`);
