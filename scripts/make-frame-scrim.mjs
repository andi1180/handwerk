// Erzeugt das statische Frame-Scrim-PNG für Intro/Outro im Reel (Schritt 8b-1c).
//
// Anders als das Caption-Scrim (8b-1b, nur unten) ist dieses Scrim VOLLFLÄCHIG:
// Intro/Outro-Text steht zentriert über dem ganzen Bild und muss auf jedem
// Hintergrund (Foto oder Verlauf) lesbar sein. Werte spiegeln den Scrim der
// öffentlichen Web-Story (app/b/[token]/booklet.css, .booklet-scrim):
//   linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 38%, rgba(0,0,0,0.62) 100%)
//
// Wir committen das Ergebnis (assets/reel/frame-scrim.png) statt es zur Laufzeit
// per ffmpeg/geq zu erzeugen: deterministisch, hier verifizierbar und als kleines
// Asset problemlos in die render-reel-Function getraced. Reproduzieren mit:
//   node scripts/make-frame-scrim.mjs
//
// Reines Node (zlib), keine Bild-Dependency — gleiche Mechanik wie
// scripts/make-caption-scrim.mjs.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 1080;
const HEIGHT = 1920;

// Stützstellen des vertikalen Verlaufs (Position 0..1 → Alpha 0..255), spiegelt
// .booklet-scrim: 0.5 @ 0% → 0.3 @ 38% → 0.62 @ 100%.
const STOPS = [
  { pos: 0.0, alpha: Math.round(0.5 * 255) }, // 128
  { pos: 0.38, alpha: Math.round(0.3 * 255) }, // 76
  { pos: 1.0, alpha: Math.round(0.62 * 255) }, // 158
];

/** Stückweise-linear interpolierter Alpha-Wert an Position t (0..1). */
function alphaAt(t) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (t >= a.pos && t <= b.pos) {
      const f = (t - a.pos) / (b.pos - a.pos);
      return Math.round(a.alpha + (b.alpha - a.alpha) * f);
    }
  }
  return STOPS[STOPS.length - 1].alpha;
}

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

// Rohdaten: pro Zeile ein Filter-Byte (0 = None) + RGBA*WIDTH. RGB = 0 (schwarz),
// Alpha = vertikaler Verlauf. Jede Zeile horizontal uniform → komprimiert exzellent.
const rowBytes = 1 + WIDTH * 4;
const raw = Buffer.alloc(rowBytes * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  const alpha = alphaAt(y / (HEIGHT - 1));
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
  "frame-scrim.png",
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`frame-scrim.png geschrieben: ${png.length} Bytes (${WIDTH}x${HEIGHT})`);
