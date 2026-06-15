// Slices the owner's combined character-card sheet into one master-resolution
// PNG per slot for the lobby's hi-res card overlay (render/card-overlay.ts).
//
// Input  : assets/cards/cards.png  — transparent sheet, four cards in a row
//          (exported from assets/cards/cards.aseprite; like export:art this needs
//          Aseprite locally, so the PNG is committed and CI never runs it).
// Output : packages/game/public/assets/card_<name>.png  (committed)
//
// The four cards are auto-detected as the runs of non-transparent columns, then
// each is cropped on a COMMON vertical range (so their frames stay row-aligned)
// and centre-padded to a uniform canvas. No downscale — the overlay draws these
// at full detail and the browser scales them smoothly. These are NOT routed
// through export:art (single images, not atlases), which is why the source lives
// in assets/cards/ (outside that script's assets/*.aseprite glob).
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const SRC = "assets/cards/cards.png";
const OUT_DIR = "packages/game/public/assets";
// The sheet's identities, LEFT→RIGHT. (The lobby display order is separate and
// lives in content/players.json — this is just which character each column is.)
const SHEET_ORDER = ["igorsh", "lyosha", "maks", "igorb"];
const ALPHA = 16; // opacity threshold for "this pixel is part of a card"

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
        case 1:
          v = rv + a;
          break;
        case 2:
          v = rv + b;
          break;
        case 3:
          v = rv + ((a + b) >> 1);
          break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - b);
          const pc = Math.abs(pp - c);
          v = rv + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          v = rv;
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

const alphaAt = (img, x, y) => img.px[(y * img.w + x) * 4 + 3];

/** Column runs of any non-transparent pixel → one [x0,x1] per card. */
function detectColumns(img) {
  const runs = [];
  let start = -1;
  for (let x = 0; x <= img.w; x++) {
    let any = false;
    if (x < img.w) for (let y = 0; y < img.h; y++) if (alphaAt(img, x, y) > ALPHA) { any = true; break; }
    if (any) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      runs.push([start, x - 1]);
      start = -1;
    }
  }
  return runs;
}

/** Tight top/bottom of content within columns [x0,x1]. */
function vBounds(img, x0, x1) {
  let top = -1;
  let bot = -1;
  for (let y = 0; y < img.h; y++) {
    let any = false;
    for (let x = x0; x <= x1; x++) if (alphaAt(img, x, y) > ALPHA) { any = true; break; }
    if (any) {
      if (top < 0) top = y;
      bot = y;
    }
  }
  return [top, bot];
}

const sheet = decode(readFileSync(SRC));
const cols = detectColumns(sheet);
if (cols.length !== SHEET_ORDER.length) {
  throw new Error(`detected ${String(cols.length)} cards in ${SRC}, expected ${String(SHEET_ORDER.length)}`);
}
// Common vertical range across all cards keeps their frames row-aligned; uniform
// width = the widest card, each centre-padded into it.
const bounds = cols.map(([x0, x1]) => vBounds(sheet, x0, x1));
const y0 = Math.min(...bounds.map((b) => b[0]));
const y1 = Math.max(...bounds.map((b) => b[1]));
const CH = y1 - y0 + 1;
const CW = Math.max(...cols.map(([x0, x1]) => x1 - x0 + 1));

cols.forEach(([x0, x1], i) => {
  const w = x1 - x0 + 1;
  const dx = Math.floor((CW - w) / 2);
  const out = Buffer.alloc(CW * CH * 4);
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < w; x++) {
      const si = ((y0 + y) * sheet.w + (x0 + x)) * 4;
      const di = (y * CW + (x + dx)) * 4;
      out[di] = sheet.px[si];
      out[di + 1] = sheet.px[si + 1];
      out[di + 2] = sheet.px[si + 2];
      out[di + 3] = sheet.px[si + 3];
    }
  const path = `${OUT_DIR}/card_${SHEET_ORDER[i]}.png`;
  writeFileSync(path, encode(CW, CH, out));
  console.log(`wrote ${path} (${String(CW)}x${String(CH)})`);
});
