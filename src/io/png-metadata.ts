import type { ExportMetadata } from './export-metadata';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const encoder = new TextEncoder();

const readU32 = (bytes: Uint8Array, offset: number): number =>
  (((bytes[offset] << 24) >>> 0) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>> 0;

const writeU32 = (bytes: Uint8Array, offset: number, value: number): void => {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const makeInternationalTextChunk = (metadata: ExportMetadata): Uint8Array => {
  const type = encoder.encode('iTXt');
  const keyword = encoder.encode('OpenCAD.Metadata');
  const text = encoder.encode(JSON.stringify(metadata));
  // keyword\0, compression flag, compression method, language\0,
  // translated keyword\0, then uncompressed UTF-8 text.
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword, 0);
  let cursor = keyword.length;
  data[cursor++] = 0;
  data[cursor++] = 0;
  data[cursor++] = 0;
  data[cursor++] = 0;
  data[cursor++] = 0;
  data.set(text, cursor);

  const chunk = new Uint8Array(12 + data.length);
  writeU32(chunk, 0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(type.length + data.length);
  crcInput.set(type, 0);
  crcInput.set(data, type.length);
  writeU32(chunk, chunk.length - 4, crc32(crcInput));
  return chunk;
};

export const embedPngExportMetadata = async (
  png: Blob,
  metadata: ExportMetadata,
): Promise<Blob> => {
  const bytes = new Uint8Array(await png.arrayBuffer());
  if (
    bytes.length < PNG_SIGNATURE.length ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new Error('Cannot attach export metadata: encoder did not return a PNG');
  }

  let offset = PNG_SIGNATURE.length;
  let iendOffset = -1;
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = new TextDecoder('ascii').decode(bytes.subarray(offset + 4, offset + 8));
    if (type === 'IEND') {
      iendOffset = offset;
      break;
    }
    offset += 12 + length;
  }
  if (iendOffset < 0) throw new Error('Cannot attach export metadata: PNG has no IEND chunk');

  const metadataChunk = makeInternationalTextChunk(metadata);
  const out = new Uint8Array(bytes.length + metadataChunk.length);
  out.set(bytes.subarray(0, iendOffset), 0);
  out.set(metadataChunk, iendOffset);
  out.set(bytes.subarray(iendOffset), iendOffset + metadataChunk.length);
  return new Blob([out], { type: 'image/png' });
};
