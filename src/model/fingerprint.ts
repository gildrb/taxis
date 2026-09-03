export function fingerprintBytes(bytes: Uint8Array | Uint8ClampedArray, firstSalt = 0, secondSalt = 0): string {
  let first = 0xdeadbeef ^ bytes.length ^ firstSalt;
  let second = 0x41c6ce57 ^ bytes.length ^ secondSalt;
  first = Math.imul(first ^ secondSalt, 2_654_435_761);
  second = Math.imul(second ^ firstSalt, 1_597_334_677);
  for (let index = 0; index < bytes.length; index++) {
    const value = bytes[index] ?? 0;
    first = Math.imul(first ^ value, 2_654_435_761);
    second = Math.imul(second ^ value, 1_597_334_677);
  }
  first = Math.imul(first ^ (first >>> 16), 2_246_822_507) ^ Math.imul(second ^ (second >>> 13), 3_266_489_909);
  second = Math.imul(second ^ (second >>> 16), 2_246_822_507) ^ Math.imul(first ^ (first >>> 13), 3_266_489_909);
  return `${toHex(second)}${toHex(first)}`;
}

export function fingerprintText(value: string): string {
  return fingerprintBytes(new TextEncoder().encode(value));
}

export function legacyFingerprintPixels(width: number, height: number, pixels: Uint8ClampedArray): string {
  let hash = 2_166_136_261;
  hash = Math.imul(hash ^ width, 16_777_619);
  hash = Math.imul(hash ^ height, 16_777_619);
  for (let index = 0; index < pixels.length; index++) {
    hash = Math.imul(hash ^ (pixels[index] ?? 0), 16_777_619);
  }
  return toHex(hash);
}

export function legacyFingerprintText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return toHex(hash);
}

function toHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}
