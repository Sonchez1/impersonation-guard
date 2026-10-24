// Generates icon16/48/128.png (a shield with a check) without any image library.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../packages/extension/icons");
mkdirSync(out, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Shield: flat top, straight sides, pointed bottom. Check mark inside. Supersampled 4x.
function shieldPixel(x, y, size) {
  const S = 4; let hit = 0, check = 0;
  for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
    const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
    const inShield = v >= 0.08 && u >= 0.12 && u <= 0.88 && (v <= 0.55 || Math.abs(u - 0.5) <= 0.38 * (1 - (v - 0.55) / 0.4)) && v <= 0.95;
    if (inShield) {
      hit++;
      // check mark: two segments
      const d1 = Math.abs((v - 0.52) - (u - 0.32) * 0.9) < 0.055 && u >= 0.3 && u <= 0.47;
      const d2 = Math.abs((v - 0.66) + (u - 0.46) * 0.95) < 0.055 && u >= 0.44 && u <= 0.72;
      if (d1 || d2) check++;
    }
  }
  if (!hit) return [0, 0, 0, 0];
  const a = Math.round((hit / (S * S)) * 255);
  const t = check / Math.max(hit, 1);
  const base = [29, 78, 216], white = [255, 255, 255];
  return [Math.round(base[0] * (1 - t) + white[0] * t), Math.round(base[1] * (1 - t) + white[1] * t), Math.round(base[2] * (1 - t) + white[2] * t), a];
}

for (const size of [16, 48, 128]) writeFileSync(resolve(out, `icon${size}.png`), png(size, shieldPixel));
console.log("icons written to", out);
