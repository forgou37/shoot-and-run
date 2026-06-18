// Builds the title-screen background from the owner's raw art into the arena's
// pixel resolution. Pure Node (no Aseprite, no deps); like export:cards the
// output is committed and CI never runs this.
//
// Input  : assets/backgrounds/title.png — raw 1408×768 night-castle scene.
// Output : packages/game/public/assets/title-bg.png — 320×240 (ARENA size).
//
// Three steps:
//  1. Erase the generator's sparkle watermark (bottom-right) by harmonic
//     (Laplace) infill — the box's border colours are diffused inward, leaving
//     a seamless dark patch. It sits outside the final crop anyway, but the
//     source stays clean regardless of how the crop is reframed.
//  2. Cover-crop to a centred 4:3 window (full height) so the art fills the
//     screen with no letterbox bars.
//  3. Area-average downscale that window to 320×240 — averaging (not nearest)
//     keeps the dense source detail from aliasing into shimmer at arena res.
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const SRC = "assets/backgrounds/title.png";
const OUT = "packages/game/public/assets/title-bg.png";
const AW = 320;
const AH = 240;
// Left edge of the centred 4:3 crop window within the source (0..W-winW).
const CROP_X = 192;
// Bounding box of the four-pointed sparkle watermark + its glow, in source px.
const WM = { x0: 1254, y0: 610, x1: 1320, y1: 684 };

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function decode(buf) {
  let off = 8;
  let w = 0;
  let h = 0;
  let ct = 6;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const stride = w * ch;
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const rv = raw[p++];
      const a = x >= ch ? row[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= ch && prev ? prev[x - ch] : 0;
      let v;
      switch (f) {
        case 1: v = rv + a; break;
        case 2: v = rv + b; break;
        case 3: v = rv + ((a + b) >> 1); break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - b);
          const pc = Math.abs(pp - c);
          v = rv + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: v = rv;
      }
      row[x] = v & 255;
    }
  }
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ct === 6) {
      out[i * 4] = px[i * 4];
      out[i * 4 + 1] = px[i * 4 + 1];
      out[i * 4 + 2] = px[i * 4 + 2];
      out[i * 4 + 3] = px[i * 4 + 3];
    } else {
      out[i * 4] = px[i * ch];
      out[i * 4 + 1] = px[i * ch + 1];
      out[i * 4 + 2] = px[i * ch + 2];
      out[i * 4 + 3] = 255;
    }
  }
  return { w, h, px: out };
}

function encode(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const img = decode(readFileSync(SRC));
const { w: W, h: H, px } = img;
const idx = (x, y) => (y * W + x) * 4;

// 1. Seed the watermark box with its border's mean colour, then relax each
//    interior pixel toward the mean of its 4 neighbours (border held fixed).
let sr = 0;
let sg = 0;
let sb = 0;
let n = 0;
for (let x = WM.x0 - 2; x <= WM.x1 + 2; x++)
  for (const y of [WM.y0 - 2, WM.y1 + 2]) {
    const i = idx(x, y);
    sr += px[i];
    sg += px[i + 1];
    sb += px[i + 2];
    n++;
  }
for (let y = WM.y0 - 2; y <= WM.y1 + 2; y++)
  for (const x of [WM.x0 - 2, WM.x1 + 2]) {
    const i = idx(x, y);
    sr += px[i];
    sg += px[i + 1];
    sb += px[i + 2];
    n++;
  }
const seed = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
for (let y = WM.y0; y <= WM.y1; y++)
  for (let x = WM.x0; x <= WM.x1; x++) {
    const i = idx(x, y);
    px[i] = seed[0];
    px[i + 1] = seed[1];
    px[i + 2] = seed[2];
  }
for (let it = 0; it < 400; it++)
  for (let y = WM.y0; y <= WM.y1; y++)
    for (let x = WM.x0; x <= WM.x1; x++) {
      const i = idx(x, y);
      for (let c = 0; c < 3; c++) {
        const l = px[idx(x - 1, y) + c];
        const r = px[idx(x + 1, y) + c];
        const u = px[idx(x, y - 1) + c];
        const d = px[idx(x, y + 1) + c];
        px[i + c] = (l + r + u + d + 2) >> 2;
      }
    }

// 2 + 3. Cover-crop the centred 4:3 window, area-average down to AW×AH.
const winW = Math.round((H * AW) / AH);
const sxScale = winW / AW;
const syScale = H / AH;
const out = Buffer.alloc(AW * AH * 4);
for (let dy = 0; dy < AH; dy++)
  for (let dx = 0; dx < AW; dx++) {
    const sx0 = CROP_X + dx * sxScale;
    const sx1 = CROP_X + (dx + 1) * sxScale;
    const sy0 = dy * syScale;
    const sy1 = (dy + 1) * syScale;
    let r = 0;
    let g = 0;
    let b = 0;
    let wsum = 0;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
      const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
      for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
        const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
        const wgt = wx * wy;
        const i = idx(sx, sy);
        r += px[i] * wgt;
        g += px[i + 1] * wgt;
        b += px[i + 2] * wgt;
        wsum += wgt;
      }
    }
    const di = (dy * AW + dx) * 4;
    out[di] = Math.round(r / wsum);
    out[di + 1] = Math.round(g / wsum);
    out[di + 2] = Math.round(b / wsum);
    out[di + 3] = 255;
  }
writeFileSync(OUT, encode(AW, AH, out));
console.log(`wrote ${OUT} (${String(AW)}x${String(AH)})`);
