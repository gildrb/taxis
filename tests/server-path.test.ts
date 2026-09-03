import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAssetPath, resolveExistingAssetPath } from "../src/server-path";

describe("production asset paths", () => {
  test("keeps normal assets inside dist", () => {
    expect(resolveAssetPath("dist", "/")).toEndWith("/dist/index.html");
    expect(resolveAssetPath("dist", "/assets/app.js")).toEndWith("/dist/assets/app.js");
  });

  test("rejects encoded traversal and malformed URI sequences", () => {
    expect(resolveAssetPath("dist", "/..%2fpackage.json")).toBeUndefined();
    expect(resolveAssetPath("dist", "/%2e%2e/bun.lock")).toBeUndefined();
    expect(resolveAssetPath("dist", "/%E0%A4%A")).toBeUndefined();
    expect(resolveAssetPath("dist", "/%00")).toBeUndefined();
    expect(resolveAssetPath("dist", "/%1f")).toBeUndefined();
    expect(resolveAssetPath("dist", "/..%5cpackage.json")).toBeUndefined();
  });

  test("rejects symlinks that resolve outside the asset root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pattern-lab-assets-"));
    const root = join(directory, "dist");
    const secret = join(directory, "secret.txt");
    await mkdir(root);
    await writeFile(secret, "secret");
    await symlink(secret, join(root, "leak.txt"));
    try {
      expect(await resolveExistingAssetPath(root, "/leak.txt")).toBeUndefined();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
