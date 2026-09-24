// Generates the app icon (a multi-colour ring, like the dashboard meters) as PNGs with no dependencies.
import fs from 'node:fs';
import zlib from 'node:zlib';

const STOPS = ['#12a578', '#3a86ee', '#8f7cf0', '#e8558f', '#ee6428', '#c08800', '#12a578'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

function colourAt(t) {
  const x = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  return STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f));
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const outer = size * 0.46;
  const inner = size * 0.30;
  const bgR = size * 0.5;
  const SS = 4;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS - c;
        const py = y + (sy + 0.5) / SS - c;
        const d = Math.hypot(px, py);
        if (d <= outer && d >= inner) {
          const t = ((Math.atan2(py, px) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
          const [cr, cg, cb] = colourAt(t);
          r += cr; g += cg; b += cb; a += 255;
        } else if (d < bgR) {
          r += 16; g += 16; b += 22; a += 255;
        }
      }
      const n = SS * SS;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r / n; raw[o + 1] = g / n; raw[o + 2] = b / n; raw[o + 3] = a / n;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

fs.writeFileSync('build/icon.png', png(256));
fs.writeFileSync('electron/tray.png', png(32));
console.log('icons written');
