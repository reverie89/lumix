#!/usr/bin/env node
// Single geometry source for the lumix brand mark: the L·Play monogram — a
// bold "l" stem whose foot breaks into a play triangle — on a rounded tile
// tinted with the landing page accent. Emits the SVG master and a multi-size
// ICO (PNG entries, no dependencies). Rerun after changing the colors or the
// geometry below; the inline header glyph in landing.html mirrors the same
// coordinates scaled to a 24-unit viewBox.
import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ACCENT = "#8ab4f8";
const ON_ACCENT = "#062e6f";

// Coordinates on a 512-unit canvas. The glyph bounding box is centered:
// stem 155..261 + foot 155..357 → x center 256, y center 256. The foot's
// bottom edge starts exactly on the stem's bottom edge (195,400) and passes
// through the end of the stem's bottom-right corner arc (261,372), so the
// silhouette is one continuous line with no steps where the shapes join.
const CANVAS = 512;
const TILE = { x: 32, y: 32, w: 448, h: 448, r: 96 };
const STEM = { x: 155, y: 112, w: 106, h: 288, r: 28 };
const FOOT = [
  { x: 195, y: 262.5 },
  { x: 357, y: 331.3 },
  { x: 195, y: 400 },
];

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

// --- geometry → coverage --------------------------------------------------

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function inRoundRect(px, py, { x, y, w, h, r }) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const dx = Math.max(x + r - px, px - (x + w - r), 0);
  const dy = Math.max(y + r - py, py - (y + h - r), 0);
  return dx * dx + dy * dy <= r * r;
}

function inTriangle([a, b, c], px, py) {
  const edge = (p, q) => (q.x - p.x) * (py - p.y) - (q.y - p.y) * (px - p.x);
  const d1 = edge(a, b);
  const d2 = edge(b, c);
  const d3 = edge(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// 4×4 supersampled box filter; colors are averaged premultiplied so the
// tile's edge blends toward transparent without a dark fringe.
function render(size) {
  const S = 4;
  const step = CANVAS / (size * S);
  const [tr, tg, tb] = hexToRgb(ACCENT);
  const [gr, gg, gb] = hexToRgb(ON_ACCENT);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = (x * S + sx + 0.5) * step;
          const py = (y * S + sy + 0.5) * step;
          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0;
          if (inRoundRect(px, py, TILE)) {
            const glyph =
              inRoundRect(px, py, STEM) || inTriangle(FOOT, px, py);
            [cr, cg, cb] = glyph ? [gr, gg, gb] : [tr, tg, tb];
            ca = 1;
          }
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const k = (y * size + x) * 4;
      if (a > 0) {
        out[k] = Math.round(r / a);
        out[k + 1] = Math.round(g / a);
        out[k + 2] = Math.round(b / a);
        out[k + 3] = Math.round((a / (S * S)) * 255);
      }
    }
  }
  return out;
}

// --- PNG (8-bit RGBA, filter 0) --------------------------------------------

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function pngEncode(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- ICO (directory + embedded PNGs) ---------------------------------------

function icoEncode(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const e = i * 16;
    dir[e] = size >= 256 ? 0 : size; // 0 means 256
    dir[e + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, e + 4); // planes
    dir.writeUInt16LE(32, e + 6); // bpp
    dir.writeUInt32LE(png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

// --- SVG master -------------------------------------------------------------

function roundRectPath({ x, y, w, h, r }) {
  return [
    `M${x + r} ${y}`,
    `H${x + w - r}`,
    `A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - r}`,
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H${x + r}`,
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

function svgSource() {
  const foot = FOOT.map((p) => `${p.x} ${p.y}`).join(" L");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}">
  <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.w}" height="${TILE.h}" rx="${TILE.r}" fill="${ACCENT}"/>
  <path fill="${ON_ACCENT}" d="${roundRectPath(STEM)}"/>
  <path fill="${ON_ACCENT}" d="M${foot} Z"/>
</svg>
`;
}

// --- main -------------------------------------------------------------------

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "img");
mkdirSync(outDir, { recursive: true });

const images = ICO_SIZES.map((size) => ({
  size,
  png: pngEncode(size, size, render(size)),
}));
writeFileSync(join(outDir, "lumix.ico"), icoEncode(images));
writeFileSync(join(outDir, "lumix.svg"), svgSource());

const kb = (buf) => `${(buf.length / 1024).toFixed(1)} KiB`;
console.log(
  `lumix.svg (${kb(Buffer.from(svgSource()))}) and lumix.ico (${kb(
    Buffer.concat(images.map((i) => i.png)),
  )}, ${ICO_SIZES.join("/")}) written to ${outDir}`,
);
