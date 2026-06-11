import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { DEFAULT_BRANDING, isHexColor } from "@/lib/settings/options";

/**
 * Server-only FFmpeg-Frame-Backerei für das Reel (Schritte 8b-1a/1b/1c).
 *
 * Sammelt die gesamte ffmpeg-Filtergraph-Logik an einer Stelle, damit die
 * render-reel-Route reine Orchestrierung bleibt (Auth/Status/Downloads/Upload).
 *
 *  - bakePhotoFrame  — Foto cover-cropt; optional Caption-Overlay (8b-1b) und/oder
 *                      dezentes Logo-Wasserzeichen (8b-1c, logo_per_page).
 *  - bakeIntroFrame  — Intro-Frame (8b-1c): Hintergrund/Verlauf + Logo + Titel +
 *                      Tagline, links-bündig, lesbar über Vollflächen-Scrim.
 *  - bakeOutroFrame  — Outro-Frame (8b-1c): Hintergrund/Verlauf + Logo +
 *                      Betriebsname + Nachricht + Kontakt (Telefon/Website).
 *  - assembleReel    — Frames → 9:16-Reel (je Frame eigene Dauer, harte Schnitte).
 *
 * Schrift + Scrims sind MITGELIEFERT und EXPLIZIT per Pfad referenziert (kein
 * System-/fontconfig-Lookup — der ist auf Vercel leer). Sie werden via
 * `outputFileTracingIncludes` (next.config.ts) in die render-reel-Function
 * getraced. NUR FFmpeg, KEIN Sharp.
 */

const execFileAsync = promisify(execFile);

/** ffmpeg darf nie hängen — Timeouts je Aufruf. */
const FRAME_TIMEOUT_MS = 60_000;
const ASSEMBLE_TIMEOUT_MS = 240_000;
const FFMPEG_MAX_BUFFER = 4 * 1024 * 1024;

/** 9:16-Hochformat (Instagram/TikTok-Reel). */
export const REEL_W = 1080;
export const REEL_H = 1920;
export const REEL_FPS = 30;

/**
 * MITGELIEFERTE Assets, EXPLIZIT referenziert. Zur Laufzeit relativ zu
 * `process.cwd()` (= Function-Root auf Vercel). Klein (Font ~130 KB, Scrims je
 * ~11 KB) — kein Größenproblem wie beim ffmpeg-Binary (8b-0).
 */
const FONT_PATH = join(process.cwd(), "assets/fonts/PlusJakartaSans-SemiBold.ttf");
/** Caption-Scrim (8b-1b): nur unten — die Foto-Hälfte oben bleibt frei. */
const CAPTION_SCRIM_PATH = join(process.cwd(), "assets/reel/caption-scrim.png");
/** Frame-Scrim (8b-1c): vollflächig — für den Intro/Outro-Text (links-bündig). */
const FRAME_SCRIM_PATH = join(process.cwd(), "assets/reel/frame-scrim.png");

/* --- Caption-Layout (8b-1b, unverändert) --- */
const SIDE_MARGIN = 80; // linker Textrand
const BOTTOM_MARGIN = 307; // ~16 % von 1920 (Safe-Zone)
const CAPTION_GAP = 28; // Abstand Textunterkante ↔ Branding-Akzentbalken
const CAPTION_FONT_SIZE = 52;
const CAPTION_LINE_SPACING = 12;
const CAPTION_MAX_CHARS = 28; // konservativer Zeilenumbruch (Glyphenbreite ungemessen)
const ACCENT_W = 72; // Caption-Akzentbalken (links unter der Caption)
const ACCENT_H = 5;

/* --- Intro/Outro-Layout (8b-1c) --- */
/** Logo prominent oben-zentriert (wie die Web-Story-Intro), in eine Box skaliert.
 *  Deutlich größer als anfangs (720×200): wirkt auf dem 9:16-Frame zu klein —
 *  breite Logos füllen jetzt ~960 px (60 px Rand je Seite), quadratische/hohe bis
 *  340 px Höhe (~1,3–1,7×). Werte nach Augenmaß, leicht nachjustierbar. */
const LOGO_BOX_W = 960;
const LOGO_BOX_H = 340;
const LOGO_TOP = 240;
/** Dezentes Logo-Wasserzeichen pro Foto (obere Ecke, logo_per_page). Etwas
 *  größer als anfangs (320×92), aber bewusst subtil. */
const WATERMARK_BOX_W = 400;
const WATERMARK_BOX_H = 116;
const WATERMARK_MARGIN = 44;
/** Branding-Akzentbalken (links-bündig am SIDE_MARGIN) unter Titel/Name. */
const CENTER_ACCENT_W = 120;
const CENTER_ACCENT_H = 6;
/** Intro (FIX 8b-1c): Logo oben → Titel → Beschreibung → Tagline (top-down).
 *  Der Titel ist bottom-anchored (Block wächst zum Logo hoch, hält Titel↔Akzent
 *  eng, egal ob 1 oder 2 Zeilen); Beschreibung + Tagline darunter top-anchored an
 *  festen y. Die Beschreibung ist die persönliche 1–2-Satz-Ich-Story — das Herz
 *  des Intros (war in 8b-1c bewusst weg, kommt jetzt zurück; Intro-Dauer ~4 s). */
const TITLE_FONT_SIZE = 72;
const TITLE_LINE_SPACING = 14;
const TITLE_MAX_CHARS = 18;
const TITLE_BOTTOM = 860;
const INTRO_ACCENT_Y = 896;
/** Beschreibung: kleiner als der Titel, weiß, links-bündig, top-anchored unter
 *  dem Akzent. Großzügige Reserve nach unten (1–2 Sätze ≈ 3–5 Zeilen). */
const DESCRIPTION_FONT_SIZE = 38;
const DESCRIPTION_LINE_SPACING = 12;
const DESCRIPTION_MAX_CHARS = 36;
const DESCRIPTION_TOP = 952;
const TAGLINE_FONT_SIZE = 34;
const TAGLINE_LINE_SPACING = 8;
const TAGLINE_MAX_CHARS = 32;
const TAGLINE_TOP = 1240;
/** Outro: Name oben, Nachricht darunter, Kontakt unten in der Safe-Zone. */
const NAME_FONT_SIZE = 64;
const NAME_LINE_SPACING = 12;
const NAME_MAX_CHARS = 20;
const NAME_BOTTOM = 720;
const OUTRO_ACCENT_Y = 752;
const MESSAGE_FONT_SIZE = 36;
const MESSAGE_LINE_SPACING = 12;
const MESSAGE_MAX_CHARS = 34;
const MESSAGE_TOP = 808;
const CONTACT_FONT_SIZE = 34;
const CONTACT_LINE_SPACING = 14;
const CONTACT_MAX_CHARS = 40;
const CONTACT_BOTTOM = 1620; // Block-Unterkante in der Safe-Zone

/** cover-crop auf 1080x1920 (Bild oder Verlauf füllt den Frame randlos). */
const COVER = `scale=${REEL_W}:${REEL_H}:force_original_aspect_ratio=increase,crop=${REEL_W}:${REEL_H},setsar=1`;

/**
 * Greedy-Wortumbruch (drawtext bricht NICHT automatisch um). Wir fügen echte
 * Zeilenumbrüche ein und schreiben den Text in eine `textfile` — so entfällt
 * jegliches Escapen von `:`/`%`/Umlauten im Filtergraph. Konservatives
 * Zeichen-Limit pro Zeile (Glyphenbreite ungemessen) → läuft nie über den Rand;
 * ein einzelnes überlanges Wort bekommt notfalls eine eigene Zeile.
 */
function wrapText(text: string, maxChars: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line === "") {
      line = word;
    } else if (line.length + 1 + word.length <= maxChars) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/** `#RRGGBB` → ffmpeg-Farbe `0xRRGGBB` (defensiv auf den Fallback fallen). */
function ffmpegColor(hex: string, fallback: string): string {
  const valid = isHexColor(hex) ? hex : fallback;
  return `0x${valid.slice(1)}`;
}

/**
 * Stellt sicher, dass Schrift + beide Scrims lesbar sind, BEVOR gerendert wird —
 * ein fehlgeschlagenes Tracing (outputFileTracingIncludes) wird so als klares
 * `assets_missing` sichtbar, nicht als kryptischer ffmpeg-Fehler. Wirft bei
 * fehlendem Asset.
 */
export async function assertReelAssets(): Promise<void> {
  await access(FONT_PATH, fsConstants.R_OK);
  await access(CAPTION_SCRIM_PATH, fsConstants.R_OK);
  await access(FRAME_SCRIM_PATH, fsConstants.R_OK);
}

/** Schreibt eine temporäre textfile (für drawtext) und merkt sie zum Aufräumen. */
async function writeTmpText(content: string, cleanup: string[]): Promise<string> {
  const path = join(tmpdir(), `reeltext-${randomUUID()}.txt`);
  await writeFile(path, content, "utf8");
  cleanup.push(path);
  return path;
}

/** Einzelne temporäre Dateien best-effort entfernen. */
async function unlinkAll(paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => unlink(p).catch(() => {})));
}

/**
 * drawtext-Baustein (gemeinsame Optionen: Schrift, expansion=none, Schatten).
 *
 * WICHTIG: `textfile` steht VOR `fontfile`. Manche ffmpeg-Builds verschlucken
 * die nachfolgende Option, wenn `fontfile` der erste drawtext-Key ist (lokal mit
 * dem 8.1.1-Build reproduziert) — `fontfile` nicht an den Anfang stellen löst das
 * standardkonform und ist für jeden korrekten Parser (Vercel 6.0.1) unkritisch.
 */
function drawText(opts: {
  textfile: string;
  fontcolor: string;
  fontsize: number;
  lineSpacing: number;
  x: string;
  y: string;
  shadowAlpha?: number;
}): string {
  const shadow = opts.shadowAlpha ?? 0.55;
  return (
    `drawtext=textfile=${opts.textfile}:fontfile=${FONT_PATH}:expansion=none:` +
    `fontcolor=${opts.fontcolor}:fontsize=${opts.fontsize}:` +
    `line_spacing=${opts.lineSpacing}:x=${opts.x}:y=${opts.y}:` +
    `shadowcolor=black@${shadow}:shadowx=0:shadowy=2`
  );
}

/**
 * Branding-Akzentbalken (drawbox) bei fester y-Position, LINKS-BÜNDIG am
 * SIDE_MARGIN — exakt wie der Caption-Akzentbalken (8b-1b), der auf dem
 * Production-Build (ffmpeg 6.0.1) bewährt rendert.
 *
 * BUGFIX 8b-1c: Vorher zentriert via `x=(iw-…)/2`. Auf 6.0.1 blieb der
 * gesamte nachfolgende Intro/Outro-Text **still leer** (Captions liefen sauber),
 * der einzige Unterschied waren die zentrierenden `(iw-…)/2`/`(w-text_w)/2`-
 * Ausdrücke — die Captions nutzen ausschließlich **literale x**. Wir ziehen den
 * Text deshalb auf dieselbe bewährte Methode: literales x, links-bündig.
 */
function accentBar(y: number, accent: string): string {
  return (
    `drawbox=x=${SIDE_MARGIN}:y=${y}:` +
    `w=${CENTER_ACCENT_W}:h=${CENTER_ACCENT_H}:color=${accent}@1.0:t=fill`
  );
}

/** Logo-Input in eine Box skalieren (Seitenverhältnis erhalten, PNG-Alpha bleibt). */
function scaleLogo(inputLabel: string, boxW: number, boxH: number, out: string): string {
  return `${inputLabel}scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease${out}`;
}

/** Hintergrund-Input: gesetztes Bild ODER Verlauf aus primary→secondary. */
function backgroundInput(
  bgPath: string | null,
  primary: string,
  secondary: string,
): string[] {
  if (bgPath) return ["-i", bgPath];
  // gradients ist eine reine libavfilter-Quelle (keine externe Lib) → in jedem
  // vollständigen Build vorhanden. Diagonaler Verlauf wie .booklet-bg--fallback.
  //
  // FIX 8b-1c: KEIN `:type=linear`. Die `type`-Option kam erst mit ffmpeg 6.1;
  // auf dem Production-Build (6.0.1, s. scripts/upload-ffmpeg.ts) crasht sie den
  // Filter → Intro/Outro scheiterte für Betriebe OHNE Hintergrundbild. `linear`
  // ist ohnehin der Default, das Weglassen ändert die Optik nicht.
  return [
    "-f",
    "lavfi",
    "-i",
    `gradients=s=${REEL_W}x${REEL_H}:c0=${primary}:c1=${secondary}:` +
      `x0=0:y0=0:x1=${REEL_W}:y1=${REEL_H}`,
  ];
}

/**
 * Ein Foto-Frame (1080x1920) backen: cover-crop; optional Caption-Overlay
 * (Scrim + Akzentbalken + drawtext, 8b-1b) und/oder Logo-Wasserzeichen oben links
 * (8b-1c, nur bei logo_per_page). Ohne beides bleibt das Foto sauber (kein Scrim).
 */
export async function bakePhotoFrame({
  ffmpegBin,
  input,
  output,
  caption,
  logoPath,
  primaryColor,
}: {
  ffmpegBin: string;
  input: string;
  output: string;
  caption: string | null;
  logoPath: string | null;
  primaryColor: string;
}): Promise<void> {
  const accent = ffmpegColor(primaryColor, DEFAULT_BRANDING.primary_color);
  const textfiles: string[] = [];

  // Schneller Pfad: sauberes Foto ohne Caption/Wasserzeichen → einfaches -vf.
  if (caption === null && !logoPath) {
    await execFileAsync(
      ffmpegBin,
      ["-y", "-nostdin", "-loglevel", "error", "-i", input, "-vf", COVER, "-frames:v", "1", output],
      { timeout: FRAME_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
    );
    return;
  }

  try {
    // Inputs: Foto (0), Caption-Scrim (falls Caption), Logo (falls Wasserzeichen).
    const inputs: string[] = ["-i", input];
    let idx = 1;
    let scrimIdx = -1;
    let logoIdx = -1;
    if (caption !== null) {
      inputs.push("-i", CAPTION_SCRIM_PATH);
      scrimIdx = idx++;
    }
    if (logoPath) {
      inputs.push("-i", logoPath);
      logoIdx = idx++;
    }

    const parts: string[] = [`[0:v]${COVER}[base]`];
    let cur = "base";

    if (caption !== null) {
      const capFile = await writeTmpText(wrapText(caption, CAPTION_MAX_CHARS), textfiles);
      parts.push(`[${cur}][${scrimIdx}:v]overlay=0:0[scr]`);
      parts.push(
        `[scr]` +
          `drawbox=x=${SIDE_MARGIN}:y=${REEL_H - BOTTOM_MARGIN}:` +
          `w=${ACCENT_W}:h=${ACCENT_H}:color=${accent}@1.0:t=fill,` +
          drawText({
            textfile: capFile,
            fontcolor: "white",
            fontsize: CAPTION_FONT_SIZE,
            lineSpacing: CAPTION_LINE_SPACING,
            x: String(SIDE_MARGIN),
            y: `h-${BOTTOM_MARGIN + CAPTION_GAP}-text_h`,
          }) +
          `[cap]`,
      );
      cur = "cap";
    }

    if (logoPath) {
      parts.push(scaleLogo(`[${logoIdx}:v]`, WATERMARK_BOX_W, WATERMARK_BOX_H, "[wm]"));
      parts.push(`[${cur}][wm]overlay=${WATERMARK_MARGIN}:${WATERMARK_MARGIN}[out]`);
      cur = "out";
    }

    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        ...inputs,
        "-filter_complex",
        parts.join(";"),
        "-map",
        `[${cur}]`,
        "-frames:v",
        "1",
        output,
      ],
      { timeout: FRAME_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
    );
  } finally {
    await unlinkAll(textfiles);
  }
}

/**
 * Intro-Frame (1080x1920) backen (8b-1c, FIX): Hintergrund (Bild cover-crop oder
 * Verlauf) → Vollflächen-Scrim → Logo prominent oben (zentriert) → Titel (groß,
 * links-bündig) → Akzentbalken → Beschreibung (1–2 Sätze, die persönliche
 * Ich-Story) → Tagline darunter. Die Beschreibung war in 8b-1c bewusst weg, ist
 * aber das Herz der Personalisierung — sie kommt mit längerer Intro-Dauer (~4 s)
 * zurück. Alle drawtext links-bündig mit literalem x (auf 6.0.1 bewährt).
 */
export async function bakeIntroFrame({
  ffmpegBin,
  output,
  title,
  description,
  tagline,
  bgPath,
  logoPath,
  primaryColor,
  secondaryColor,
}: {
  ffmpegBin: string;
  output: string;
  title: string;
  description: string | null;
  tagline: string | null;
  bgPath: string | null;
  logoPath: string | null;
  primaryColor: string;
  secondaryColor: string;
}): Promise<void> {
  const primary = ffmpegColor(primaryColor, DEFAULT_BRANDING.primary_color);
  const secondary = ffmpegColor(secondaryColor, DEFAULT_BRANDING.secondary_color);
  const textfiles: string[] = [];

  try {
    // Inputs: Hintergrund (0), Frame-Scrim (1), Logo (falls vorhanden, 2).
    const inputs: string[] = [
      ...backgroundInput(bgPath, primary, secondary),
      "-i",
      FRAME_SCRIM_PATH,
    ];
    const logoIdx = logoPath ? 2 : -1;
    if (logoPath) inputs.push("-i", logoPath);

    const parts: string[] = [`[0:v]${COVER}[base]`, `[base][1:v]overlay=0:0[scr]`];
    let cur = "scr";
    if (logoPath) {
      parts.push(scaleLogo(`[${logoIdx}:v]`, LOGO_BOX_W, LOGO_BOX_H, "[logo]"));
      parts.push(`[${cur}][logo]overlay=x=(W-w)/2:y=${LOGO_TOP}[bg]`);
      cur = "bg";
    }

    const titleFile = await writeTmpText(wrapText(title, TITLE_MAX_CHARS), textfiles);
    const draws: string[] = [
      accentBar(INTRO_ACCENT_Y, primary),
      drawText({
        textfile: titleFile,
        fontcolor: "white",
        fontsize: TITLE_FONT_SIZE,
        lineSpacing: TITLE_LINE_SPACING,
        x: String(SIDE_MARGIN),
        y: `${TITLE_BOTTOM}-text_h`,
        shadowAlpha: 0.6,
      }),
    ];
    if (description) {
      const descriptionFile = await writeTmpText(
        wrapText(description, DESCRIPTION_MAX_CHARS),
        textfiles,
      );
      draws.push(
        drawText({
          textfile: descriptionFile,
          fontcolor: "white",
          fontsize: DESCRIPTION_FONT_SIZE,
          lineSpacing: DESCRIPTION_LINE_SPACING,
          x: String(SIDE_MARGIN),
          y: String(DESCRIPTION_TOP),
          shadowAlpha: 0.55,
        }),
      );
    }
    if (tagline) {
      const taglineFile = await writeTmpText(
        wrapText(tagline.toUpperCase(), TAGLINE_MAX_CHARS),
        textfiles,
      );
      draws.push(
        drawText({
          textfile: taglineFile,
          fontcolor: primary,
          fontsize: TAGLINE_FONT_SIZE,
          lineSpacing: TAGLINE_LINE_SPACING,
          x: String(SIDE_MARGIN),
          y: String(TAGLINE_TOP),
          shadowAlpha: 0.5,
        }),
      );
    }
    parts.push(`[${cur}]${draws.join(",")}[out]`);

    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        ...inputs,
        "-filter_complex",
        parts.join(";"),
        "-map",
        "[out]",
        "-frames:v",
        "1",
        output,
      ],
      { timeout: FRAME_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
    );
  } finally {
    await unlinkAll(textfiles);
  }
}

/**
 * Outro-Frame (1080x1920) backen (8b-1c): Hintergrund (Bild/Verlauf) →
 * Vollflächen-Scrim → Logo oben → Betriebsname → Akzentbalken → Nachricht →
 * Kontakt (Telefon/Website) unten in der Safe-Zone. KEINE Share-/Review-Elemente
 * (das ist Step 9; das Reel ist eine Datei, kein interaktiver Hub).
 */
export async function bakeOutroFrame({
  ffmpegBin,
  output,
  businessName,
  message,
  contactLines,
  bgPath,
  logoPath,
  primaryColor,
  secondaryColor,
}: {
  ffmpegBin: string;
  output: string;
  businessName: string;
  message: string | null;
  contactLines: string[];
  bgPath: string | null;
  logoPath: string | null;
  primaryColor: string;
  secondaryColor: string;
}): Promise<void> {
  const primary = ffmpegColor(primaryColor, DEFAULT_BRANDING.primary_color);
  const secondary = ffmpegColor(secondaryColor, DEFAULT_BRANDING.secondary_color);
  const textfiles: string[] = [];

  try {
    const inputs: string[] = [
      ...backgroundInput(bgPath, primary, secondary),
      "-i",
      FRAME_SCRIM_PATH,
    ];
    const logoIdx = logoPath ? 2 : -1;
    if (logoPath) inputs.push("-i", logoPath);

    const parts: string[] = [`[0:v]${COVER}[base]`, `[base][1:v]overlay=0:0[scr]`];
    let cur = "scr";
    if (logoPath) {
      parts.push(scaleLogo(`[${logoIdx}:v]`, LOGO_BOX_W, LOGO_BOX_H, "[logo]"));
      parts.push(`[${cur}][logo]overlay=x=(W-w)/2:y=${LOGO_TOP}[bg]`);
      cur = "bg";
    }

    const nameFile = await writeTmpText(wrapText(businessName, NAME_MAX_CHARS), textfiles);
    const draws: string[] = [
      accentBar(OUTRO_ACCENT_Y, primary),
      drawText({
        textfile: nameFile,
        fontcolor: "white",
        fontsize: NAME_FONT_SIZE,
        lineSpacing: NAME_LINE_SPACING,
        x: String(SIDE_MARGIN),
        y: `${NAME_BOTTOM}-text_h`,
        shadowAlpha: 0.6,
      }),
    ];
    if (message) {
      const messageFile = await writeTmpText(
        wrapText(message, MESSAGE_MAX_CHARS),
        textfiles,
      );
      draws.push(
        drawText({
          textfile: messageFile,
          fontcolor: "white",
          fontsize: MESSAGE_FONT_SIZE,
          lineSpacing: MESSAGE_LINE_SPACING,
          x: String(SIDE_MARGIN),
          y: String(MESSAGE_TOP),
          shadowAlpha: 0.5,
        }),
      );
    }
    if (contactLines.length > 0) {
      // Mehrere Kontaktzeilen als ein Block (untereinander), unten verankert.
      const contactFile = await writeTmpText(contactLines.join("\n"), textfiles);
      draws.push(
        drawText({
          textfile: contactFile,
          fontcolor: "white",
          fontsize: CONTACT_FONT_SIZE,
          lineSpacing: CONTACT_LINE_SPACING,
          x: String(SIDE_MARGIN),
          y: `${CONTACT_BOTTOM}-text_h`,
          shadowAlpha: 0.5,
        }),
      );
    }
    parts.push(`[${cur}]${draws.join(",")}[out]`);

    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        ...inputs,
        "-filter_complex",
        parts.join(";"),
        "-map",
        "[out]",
        "-frames:v",
        "1",
        output,
      ],
      { timeout: FRAME_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
    );
  } finally {
    await unlinkAll(textfiles);
  }
}

/**
 * Frames → 9:16-Reel: je Frame eine eigene Dauer (`-loop 1 -t s`), HARTE
 * Schnitte (concat-Filter), h264 + yuv420p + +faststart, KEIN Audio. Pro Input
 * `setsar=1,fps,format=yuv420p` (vereinheitlicht RGB/RGBA der Frames — concat
 * verlangt EIN Format).
 */
export async function assembleReel({
  ffmpegBin,
  frames,
  output,
}: {
  ffmpegBin: string;
  frames: { path: string; seconds: number }[];
  output: string;
}): Promise<void> {
  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  frames.forEach((frame, i) => {
    inputArgs.push("-loop", "1", "-t", String(frame.seconds), "-i", frame.path);
    filterParts.push(`[${i}:v]setsar=1,fps=${REEL_FPS},format=yuv420p[v${i}]`);
  });
  const concatInputs = frames.map((_, i) => `[v${i}]`).join("");
  const filterComplex =
    `${filterParts.join(";")};${concatInputs}concat=n=${frames.length}:v=1:a=0[outv]`;

  await execFileAsync(
    ffmpegBin,
    [
      "-y",
      "-nostdin",
      "-loglevel",
      "error",
      ...inputArgs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[outv]",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-movflags",
      "+faststart",
      "-an",
      output,
    ],
    { timeout: ASSEMBLE_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
  );
}
