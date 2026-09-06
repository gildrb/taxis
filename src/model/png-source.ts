const MAX_PNG_BYTES = 50 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_777_216;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

/** Restores our embedded RGB/RGBA PNG bytes without Canvas alpha conversion. */
export async function decodeSourcePng(bytes: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8ClampedArray }> {
  if (bytes.length < 45 || bytes.length > MAX_PNG_BYTES || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error("Embedded PNG data must be a valid PNG smaller than 50 MB.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  let ended = false;
  let endedImageData = false;
  let seenPalette = false;
  let compressedLength = 0;
  const chunks: Uint8Array[] = [];
  let chunkCount = 0;
  for (let offset = 8; offset < bytes.length;) {
    if (++chunkCount > 10_000) throw new Error("Embedded PNG has too many chunks.");
    if (bytes.length - offset < 12) throw new Error("Embedded PNG contains a truncated chunk.");
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) throw new Error("Embedded PNG contains a truncated chunk.");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) throw new Error("Embedded PNG contains an invalid chunk type.");
    let crc = 0xffffffff;
    for (let index = offset + 4; index < offset + 8 + length; index++) crc = CRC_TABLE[(crc ^ bytes[index]!) & 255]! ^ (crc >>> 8);
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(offset + 8 + length)) throw new Error("Embedded PNG chunk checksum is invalid.");
    const data = offset + 8;
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) throw new Error("Embedded PNG has an invalid image header.");
      width = view.getUint32(data);
      height = view.getUint32(data + 4);
      if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
        throw new Error("Embedded PNG dimensions must be from 1 to 4096 with at most 16,777,216 pixels.");
      }
      const colorType = bytes[data + 9];
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
      if (bytes[data + 8] !== 8 || !channels || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || bytes[data + 12] !== 0) {
        throw new Error("Embedded PNG must use non-interlaced 8-bit RGB or RGBA. Import the source image again to re-embed it.");
      }
    } else {
      if (!width) throw new Error("Embedded PNG must start with its image header.");
      if (type === "IDAT") {
        if (endedImageData) throw new Error("Embedded PNG image-data chunks must be consecutive.");
        compressedLength += length;
        chunks.push(bytes.subarray(data, data + length));
      } else {
        if (chunks.length) endedImageData = true;
        if (type === "IEND") {
          if (length !== 0 || compressedLength === 0 || offset + 12 !== bytes.length) throw new Error("Embedded PNG has an invalid end chunk.");
          ended = true;
        } else if (type === "PLTE") {
          if (seenPalette || chunks.length || length === 0 || length % 3 !== 0 || length > 768) throw new Error("Embedded PNG has an invalid optional palette.");
          seenPalette = true;
        } else if (type === "tRNS" || type === "acTL" || type === "fcTL" || type === "fdAT") {
          throw new Error("Embedded PNG must contain plain RGB or RGBA pixels, without palette transparency or animation.");
        } else if (type[0] === type[0]!.toUpperCase()) throw new Error(`Embedded PNG chunk ${type} is not supported.`);
      }
    }
    offset += length + 12;
  }
  if (!ended) throw new Error("Embedded PNG is missing its end chunk.");

  const stride = width * channels;
  const expectedBytes = (stride + 1) * height;
  const compressed = new Uint8Array(compressedLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  // Allocate only after validating the complete structure and dimensions.
  // Bound each inflated chunk before copying; a deflate bomb cannot grow this.
  const scanlines = new Uint8Array(expectedBytes);
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  let written = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > expectedBytes - written) throw new Error("decompressed data exceeds the declared dimensions");
      scanlines.set(value, written);
      written += value.length;
    }
    if (written !== expectedBytes) throw new Error("decompressed data does not match the declared dimensions");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw new Error(`Embedded PNG decompression failed: ${error instanceof Error ? error.message : "invalid compressed pixels"}.`);
  } finally {
    reader.releaseLock();
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  let previous = new Uint8Array(stride);
  let row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = scanlines[start]!;
    if (filter > 4) throw new Error("Embedded PNG uses an invalid row filter.");
    for (let index = 0; index < stride; index++) {
      const left = index < channels ? 0 : row[index - channels]!;
      const above = previous[index]!;
      const upperLeft = index < channels ? 0 : previous[index - channels]!;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const a = Math.abs(estimate - left);
        const b = Math.abs(estimate - above);
        const c = Math.abs(estimate - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? above : upperLeft;
      }
      row[index] = (scanlines[start + index + 1]! + predictor) & 255;
    }
    if (channels === 4) pixels.set(row, y * width * 4);
    else {
      for (let x = 0; x < width; x++) {
        const target = (y * width + x) * 4;
        pixels[target] = row[x * 3]!;
        pixels[target + 1] = row[x * 3 + 1]!;
        pixels[target + 2] = row[x * 3 + 2]!;
        pixels[target + 3] = 255;
      }
    }
    const completed = row;
    row = previous;
    previous = completed;
  }
  return { width, height, pixels };
}
