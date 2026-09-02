import { describe, expect, test } from "bun:test";
import { resolveAssetPath } from "../src/server-path";

describe("production asset paths", () => {
  test("keeps normal assets inside dist", () => {
    expect(resolveAssetPath("dist", "/")).toEndWith("/dist/index.html");
    expect(resolveAssetPath("dist", "/assets/app.js")).toEndWith("/dist/assets/app.js");
  });

  test("rejects encoded traversal and malformed URI sequences", () => {
    expect(resolveAssetPath("dist", "/..%2fpackage.json")).toBeUndefined();
    expect(resolveAssetPath("dist", "/%2e%2e/bun.lock")).toBeUndefined();
    expect(resolveAssetPath("dist", "/%E0%A4%A")).toBeUndefined();
  });
});
