import { describe, expect, test } from "bun:test";
import { reflectSource } from "@vgpu/wgsl/reflect-source";
import { ORB_SHADER } from "../src/render/webgpu";

describe("vgpu WGSL", () => {
  test("reflects the fragment entry point and complete bindings", () => {
    const reflection = reflectSource(ORB_SHADER, "orb-inline.wgsl");
    expect(reflection.entryPoints.some((entry) => entry.name === "fs_main" && entry.stage === "fragment")).toBe(true);
    expect(reflection.bindings.map((binding) => binding.name)).toEqual([
      "source_texture",
      "source_sampler",
      "params",
    ]);
  });
});
