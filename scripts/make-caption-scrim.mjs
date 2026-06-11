// Erzeugt das statische Caption-Scrim-PNG für das Reel (Schritt 8b-1b).
//
// Das Scrim ist ein vertikaler Verlauf transparent → dunkel, der beim Render
// über das untere Drittel der cover-gecroppten Fotos gelegt wird, damit der
// weiße Caption-Text auf jedem Bild lesbar bleibt. Werte spiegeln den Scrim der
// öffentlichen Web-Story (app/b/[token]/booklet.css, .booklet-caption-scrim):
//   linear-gradient(180deg, transparent 0%, transparent 42%, rgba(0,0,0,0.72) 100%)
//
// Wir committen das Ergebnis (assets/reel/caption-scrim.png) statt es zur
// Laufzeit per ffmpeg/geq zu erzeugen: deterministisch, hier verifizierbar und
// als kleines Asset problemlos in die Function getraced (kein geq-Risiko auf
// Vercel). Reproduzieren mit:  node scripts/make-caption-scrim.mjs
//
// Reines Node (zlib), keine Bild-Dependency.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 1080;
const HEIGHT = 1920;
const START = 0.42; // bis hier voll transparent (oberer Bildbereich bleibt frei)
const MAX_ALPHA = 184; // 0.72 * 255 ≈ 184 (Boden), wie die Web-Story

// --- CRC32 (PNG-Chunks), eigene Tabelle → versionsunabhängig ---
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

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// IHDR: 8-bit, Farbtyp 6 (RGBA), keine Interlace
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

// Rohdaten: pro Zeile ein Filter-Byte (0 = None) + RGBA*WIDTH.
// RGB = 0 (schwarz), Alpha = vertikaler Verlauf. Jede Zeile horizontal uniform
// → komprimiert exzellent.
const rowBytes = 1 + WIDTH * 4;
const raw = Buffer.alloc(rowBytes * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  const frac = (y / (HEIGHT - 1) - START) / (1 - START);
  const t = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  const alpha = Math.round(MAX_ALPHA * t);
  const rowStart = y * rowBytes;
  raw[rowStart] = 0; // filter: None
  for (let x = 0; x < WIDTH; x++) {
    const p = rowStart + 1 + x * 4;
    raw[p] = 0; // R
    raw[p + 1] = 0; // G
    raw[p + 2] = 0; // B
    raw[p + 3] = alpha; // A
  }
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG-Signatur
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "reel",
  "caption-scrim.png",
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`caption-scrim.png geschrieben: ${png.length} Bytes (${WIDTH}x${HEIGHT})`);
