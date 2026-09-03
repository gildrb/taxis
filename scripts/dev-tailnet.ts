import { isIP } from "node:net";

const addressResult = Bun.spawnSync(["tailscale", "ip", "-4"], { stdout: "pipe", stderr: "pipe" });
if (addressResult.exitCode !== 0) {
  throw new Error(`Tailscale IPv4 lookup failed: ${addressResult.stderr.toString().trim() || "tailscale is unavailable"}`);
}
const hostname = addressResult.stdout.toString().trim();
if (isIP(hostname) !== 4 || hostname.startsWith("127.")) {
  throw new Error(`Tailscale returned an invalid IPv4 address: ${hostname || "(empty)"}`);
}

const server = Bun.spawn(["bun", "--hot", "src/server.ts"], {
  env: { ...process.env, NODE_ENV: "development", PATTERN_LAB_HOSTNAME: hostname },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.kill(signal));
}
process.exitCode = await server.exited;
