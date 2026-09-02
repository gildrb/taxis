import { effect, frame, init, sampler, target } from "vgpu/node";
import { createRadialMask } from "../src/model/mask";
import { DEFAULT_PARAMS } from "../src/model/params";
import { ORB_SHADER, orbUniforms } from "../src/render/webgpu";

const gpu = await init({ label: "Orb Lab shader validation" });
const output = target(gpu, { size: [64, 64], format: "rgba8unorm" });
const mask = createRadialMask(32);
const texture = gpu.gpu.createTexture({
  label: "Validation mask",
  size: [mask.width, mask.height],
  format: "rgba8unorm",
  usage: 0x02 | 0x04,
});
const pixels = new Uint8Array(mask.values.length * 4);
for (let index = 0; index < mask.values.length; index++) {
  const value = Math.round((mask.values[index] ?? 0) * 255);
  pixels.fill(value, index * 4, index * 4 + 3);
  pixels[index * 4 + 3] = 255;
}
gpu.gpu.queue.writeTexture(
  { texture },
  pixels,
  { bytesPerRow: mask.width * 4, rowsPerImage: mask.height },
  { width: mask.width, height: mask.height },
);
const orb = effect(gpu, ORB_SHADER, {
  set: {
    source_texture: texture,
    source_sampler: sampler(gpu, { magFilter: "linear", minFilter: "linear" }),
    params: orbUniforms(
      { params: DEFAULT_PARAMS, mask, time: 0.25, pointer: [0, 0], audio: 0 },
      output.size,
    ),
  },
});

await orb.compile(output);
frame(gpu, (current) => current.pass(output, orb));
const rendered = await output.read();
let coloredPixels = 0;
for (let index = 0; index < rendered.length; index += 4) {
  if ((rendered[index] ?? 0) + (rendered[index + 1] ?? 0) + (rendered[index + 2] ?? 0) > 0) {
    coloredPixels++;
  }
}
if (coloredPixels < 100) throw new Error("Shader produced an empty frame.");

texture.destroy();
gpu.dispose();
console.log("Orb WGSL compiled and rendered 64 × 64 pixels.");
