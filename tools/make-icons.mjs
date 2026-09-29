// Draws the app icon (a globe with the meridian marked in amber) and writes PNGs.
// Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [20, 19, 15], INK = [236, 231, 218], AMBER = [224, 165, 38];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
const crc32 = buf => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// safe = fraction of the canvas the artwork may use (maskable icons need padding).
function render(size, safe) {
  const SS = 3, px = Buffer.alloc(size * size * 3);
  const c = size / 2, R = (size / 2) * safe;
  const seg = (x, y, x1, y1, x2, y2) => {           // distance from point to segment
    const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
  };
  const ang = a => [Math.sin(a), -Math.cos(a)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = x + (sx + .5) / SS, Y = y + (sy + .5) / SS;
      const d = Math.hypot(X - c, Y - c);
      let col = BG;
      const dx = X - c, dy = Y - c, ring = R * 0.86;
      const band = (f, r, w) => Math.abs(f - 1) * r < w;                        // thin band around an ellipse
      if (band(d / ring, ring, R * 0.05)) col = INK;                            // globe outline
      if (d < ring) {
        const e = Math.hypot(dx / (R * 0.42), dy / ring);
        if (band(e, R * 0.42, R * 0.04)) col = INK;                             // the side meridians, drawn as one ellipse
        if (Math.abs(dy) < R * 0.04) col = INK;                                 // equator
      }
      if (Math.abs(dx) < R * 0.07 && Math.abs(dy) < ring + R * 0.09) col = AMBER; // the meridian, sticking out past the globe
      if (Math.hypot(dx, dy) < R * 0.17) col = BG;                              // gap around the marker
      if (Math.hypot(dx, dy) < R * 0.11) col = AMBER;                           // "now" marker where it crosses the equator
      acc = acc.map((v, i) => v + col[i]);
    }
    px.set(acc.map(v => Math.round(v / (SS * SS))), (y * size + x) * 3);
  }
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 3 + 1)] = 0; px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('icons/icon-192.png', render(192, 0.94));
writeFileSync('icons/icon-512.png', render(512, 0.94));
writeFileSync('icons/icon-maskable-512.png', render(512, 0.72));
writeFileSync('icons/apple-touch-icon.png', render(180, 0.94));
console.log('icons written');
