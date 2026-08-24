/* A minimal PNG writer: RGBA in, bytes out.
 *
 * Written rather than installed because it is about sixty lines and the
 * alternative is a native image dependency in a repository whose entire job
 * is to render one banner once a week. Nothing here needs resizing, colour
 * management, EXIF or format conversion - the pixels arrive already correct
 * from the field renderer, and all that is missing is the container.
 *
 * The format, in full, for what this uses:
 *
 *   signature   8 bytes, fixed
 *   IHDR        width, height, bit depth 8, colour type 6 (RGBA), no
 *               interlacing
 *   IDAT        zlib stream of scanlines, each prefixed with its filter type
 *   IEND        empty
 *
 * Every chunk is length, type, data, CRC32 of type+data.
 */

import { deflateSync } from "node:zlib";

/* PNG's CRC is the standard IEEE 802.3 one, and the table is built rather
   than pasted so there is nothing to typo. node:zlib gained a `crc32` export
   recently, but it is newer than the runtimes this might be pinned to and
   this is eight lines. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length); // length covers the data only, not the type
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

/**
 * Encode `rgba` (width * height * 4 bytes, non-premultiplied) as a PNG.
 *
 * Filter type 0 - "none" - on every scanline. The clever filters (Sub, Up,
 * Paeth) exist to make deflate's job easier on photographic data, and would
 * save perhaps a fifth on this one. A banner that is already well under a
 * hundred kilobytes does not need it, and the filter byte still has to be
 * there either way, which is the part that is easy to forget.
 */
export function encodePng(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(
      `png: got ${rgba.length} bytes for ${width}x${height}, want ${expected}`,
    );
  }

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
