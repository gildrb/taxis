import { afterEach, describe, expect, test } from "bun:test";

const children: Bun.ReadableSubprocess[] = [];
const blockers: ReturnType<typeof Bun.serve>[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
    await child.exited;
  }
  for (const blocker of blockers.splice(0)) blocker.stop(true);
});

function spawnServer(env: Record<string, string | undefined>) {
  const child = Bun.spawn(["bun", "src/server.ts"], {
    cwd: import.meta.dir.replace(/\/tests$/, ""),
    env: { ...env, PATTERN_LAB_HOSTNAME: "127.0.0.1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  return child;
}

async function waitForServerUrl(child: Bun.ReadableSubprocess, timeoutMs = 10_000) {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  const timeout = setTimeout(() => child.kill(), timeoutMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`Server exited before starting:\n${output}`);
      output += decoder.decode(value, { stream: true });
      const match = output.match(/Pattern Lab running at (http:\/\/[^\s]+)/);
      if (match?.[1]) return match[1];
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

describe("development server ports", () => {
  test(
    "uses the next available port when the default is occupied",
    async () => {
      try {
        blockers.push(
          Bun.serve({
            port: 3000,
            hostname: "127.0.0.1",
            fetch: () => new Response("occupied"),
          }),
        );
      } catch (error) {
        const addressInUse =
          typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
        if (!addressInUse) throw error;
      }

      const env = { ...process.env };
      delete env.PORT;
      delete env.NODE_ENV;
      const child = spawnServer(env);
      const url = await waitForServerUrl(child);

      expect(new URL(url).port).not.toBe("3000");
      expect((await fetch(url)).status).toBe(200);
    },
    15_000,
  );

  test("does not override an explicitly configured occupied port", async () => {
    const blocker = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("occupied"),
    });
    blockers.push(blocker);

    const child = spawnServer({
      ...process.env,
      NODE_ENV: undefined,
      PORT: String(blocker.port),
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).not.toBe(0);
    expect(`${stdout}\n${stderr}`).toContain("EADDRINUSE");
  });
});
