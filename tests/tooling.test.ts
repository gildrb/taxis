import { afterEach, expect, test } from "bun:test";
import { lstat, readFile, readdir } from "node:fs/promises";

const root = import.meta.dir.replace(/\/tests$/, "");
const children: Bun.ReadableSubprocess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
    await child.exited;
  }
});

async function outputFor(child: Bun.ReadableSubprocess): Promise<{ code: number; stderr: string; stdout: string }> {
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

async function waitForServerUrl(child: Bun.ReadableSubprocess): Promise<string> {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`Production server exited before starting:
${output}`);
      output += decoder.decode(value, { stream: true });
      const match = output.match(/Pattern Lab running at (http:\/\/[^\s]+)/);
      if (match?.[1]) return match[1];
    }
  } finally {
    reader.releaseLock();
  }
}


test("pins Bun while keeping the deployment lockfile backward-readable", async () => {
  const manifest = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
  const lockfile = await readFile(`${root}/bun.lock`, "utf8");
  expect(manifest.packageManager).toBe("bun@1.4.0");
  expect(manifest.engines.bun).toBe("1.4.0");
  expect(lockfile).toContain('"lockfileVersion": 1');
});

test("writes complete atomic StyleX CSS across concurrent development starts", async () => {
  const servers = Array.from({ length: 8 }, () => Bun.spawn(["bun", "run", "dev:local"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "development", PATTERN_LAB_HOSTNAME: "127.0.0.1", PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  }));
  children.push(...servers);
  const urls = await Promise.all(servers.map(waitForServerUrl));
  const styles = await Promise.all(urls.map(async (url) => {
    expect((await fetch(url)).status).toBe(200);
    const response = await fetch(new URL("/stylex.dev.css", url));
    expect(response.status).toBe(200);
    return response.text();
  }));
  for (const css of styles) {
    expect(css).not.toContain("\0");
    expect(css).toMatch(/\bwidth:\s*278px/);
    expect(css).toMatch(/\bright:\s*14px/);
  }
}, 30_000);

test("serializes concurrent builds and serves nested production routes safely", async () => {
  const builds = Array.from({ length: 3 }, () => Bun.spawn(["bun", "run", "build"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  }));
  children.push(...builds);
  const results = await Promise.all(builds.map(outputFor));
  for (const result of results) {
    expect(`${result.stdout}
${result.stderr}`).toMatch(/Built \d+ bundled assets/);
    expect(result.code).toBe(0);
  }

  const html = await readFile(`${root}/dist/index.html`, "utf8");
  expect(html).toContain('src="/main.js"');
  expect(html).toContain('href="/main.css"');
  expect((await lstat(`${root}/dist`)).isDirectory()).toBe(true);
  const releases = (await readdir(`${root}/.build-releases`, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  expect(releases.length).toBeLessThanOrEqual(3);

  const server = Bun.spawn(["bun", "src/server.ts"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", PATTERN_LAB_HOSTNAME: "127.0.0.1", PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(server);
  const url = await waitForServerUrl(server);
  const nested = await fetch(new URL("/editor/session/", url));
  expect(nested.status).toBe(200);
  expect(await nested.text()).toContain('src="/main.js"');
  expect((await fetch(new URL("/editor/missing.js", url))).status).toBe(404);
  expect((await fetch(`${url}%00`)).status).toBe(400);
  const scriptResponse = await fetch(new URL("/main.js", url));
  const etag = scriptResponse.headers.get("etag");
  expect(scriptResponse.headers.get("cache-control")).toBe("no-cache");
  expect(etag).not.toBeNull();
  const head = await fetch(new URL("/main.js", url), { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-type")).toContain("javascript");
  expect(await head.text()).toBe("");
  expect((await fetch(new URL("/main.js", url), { method: "POST" })).status).toBe(405);
  expect((await fetch(new URL("/main.js", url), { headers: { "If-None-Match": `"other", ${etag}` } })).status).toBe(304);
  expect((await fetch(new URL("/main.js", url), { headers: { "If-None-Match": "*" } })).status).toBe(304);
  const ignoredRange = await fetch(new URL("/main.js", url), { headers: { Range: "bytes=0-9", "If-Range": '"wrong"' } });
  expect(ignoredRange.status).toBe(200);
  expect((await ignoredRange.arrayBuffer()).byteLength).toBe(Number(scriptResponse.headers.get("content-length")));
}, 30_000);
