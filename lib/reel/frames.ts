import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { DEFAULT_BRANDING, isHexColor } from "@/lib/settings/options";

/**
 * Server-only FFmpeg-Frame-Backerei für das Reel (Schritte 8b-1a/1b/1c/2a).
 *
 * Sammelt die gesamte ffmpeg-Filtergraph-/Encode-Logik an einer Stelle, damit die
 * render-reel-Route reine Orchestrierung bleibt (Auth/Status/Downloads/Upload).
 *
 *  - bakePhotoFrame     — Foto cover-cropt; optional Caption-Overlay (8b-1b) und/oder
 *                         dezentes Logo-Wasserzeichen (8b-1c, logo_per_page).
 *  - bakeIntroFrame     — Intro-Frame (8b-1c): Hintergrund/Verlauf + Logo + Titel +
 *                         Beschreibung + Tagline, links-bündig über Vollflächen-Scrim.
 *  - bakeOutroFrame     — Outro-Frame (8b-1c): Hintergrund/Verlauf + Logo +
 *                         Betriebsname + Nachricht + Kontakt (Telefon/Website).
 *  - encodeStillSegment — gebackenes PNG → normalisiertes mp4-Segment (8b-2a).
 *  - normalizeClip      — Video-Clip → KANONISCHES mp4-Segment (8b-2a): cover 9:16,
 *                         30 fps, yuv420p, STUMM, auf min(Clip, maxSeconds) gecappt;
 *                         mit DERSELBEN Caption/Wasserzeichen-Overlay-Kette wie das
 *                         Foto über den Video-Stream gebrannt (8b-2b).
 *  - buildCaptionOverlay— GETEILTE Overlay-Kette (Scrim + Caption-drawtext +
 *                         optionales Logo-Wasserzeichen) für Foto UND Clip (8b-2b).
 *  - concatSegments     — formatgleiche Segmente → 9:16-Reel (concat-Demuxer,
 *                         -c copy, harte Schnitte; Intro → Items (sort_order) → Outro).
 *
 * 8b-2a interleavt Fotos (Stills) und Video-Clips nach sort_order: jedes Item wird
 * zu einem formatgleichen Zwischensegment gerendert, dann verlustfrei (concat-
 * Demuxer) gefügt — heterogene Medien gehen nur format-IDENTISCH durch concat.
 *
 * Schrift + Scrims sind MITGELIEFERT und EXPLIZIT per Pfad referenziert (kein
 * System-/fontconfig-Lookup — der ist auf Vercel leer). Sie werden via
 * `outputFileTracingIncludes` (next.config.ts) in die render-reel-Function
 * getraced. NUR FFmpeg, KEIN Sharp.
 */

const execFileAsync = promisify(execFile);

/** ffmpeg darf nie hängen — Timeouts je Aufruf. */
const FRAME_TIMEOUT_MS = 60_000;
/** Segment-Encode (8b-2a): Still-Loop bzw. Clip-Normalisierung. Großzügiger als ein
 *  PNG-Bake, weil ein Clip dekodiert + neu enkodiert wird. */
const SEGMENT_TIMEOUT_MS = 120_000;
/** concat-Demuxer (8b-2a): fügt nur die fertigen Segmente (-c copy, kein Re-Encode). */
const CONCAT_TIMEOUT_MS = 120_000;
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
/** Kleineres Wasserzeichen für die topright-Variante (Business-Reel): rechts
 *  oben, kein Konflikt mit dem VORHER/NACHHER-Label links oben. */
const WATERMARK_TR_BOX_W = 280;
const WATERMARK_TR_BOX_H = 80;
/** Branding-Akzentbalken (links-bündig am SIDE_MARGIN) unter Titel/Name. */
const CENTER_ACCENT_W = 120;
const CENTER_ACCENT_H = 6;
/** Intro (FIX 8b-2c): Logo oben → Titel → Beschreibung → Tagline.
 *  Der Titel ist bottom-anchored (Block wächst zum Logo hoch, hält Titel↔Akzent
 *  eng, egal ob 1 oder 2 Zeilen); die Beschreibung ist top-anchored unter dem
 *  Akzent — die persönliche 1–2-Satz-Ich-Story, das Herz des Intros (Dauer ~4 s).
 *
 *  ÜBERLAPP-FIX 8b-2c: Die KI-Beschreibung ist variabel lang; früher floss die
 *  Tagline an festem y (1240) direkt darunter → eine lange Beschreibung wuchs in
 *  die Tagline. Jetzt (1) ist die Tagline FEST nahe dem unteren Rand gepinnt
 *  (bottom-anchored, von der Beschreibungslänge entkoppelt) und (2) wird die
 *  Beschreibung NUR fürs Reel-Intro auf REEL_DESCRIPTION_MAX_CHARS gekürzt (mit
 *  „…"), sodass Titel+Beschreibung nie in die Tagline-Zone wachsen. Die in
 *  `booklets` gespeicherte intro_description bleibt unberührt — die Web-Story
 *  nutzt weiter die volle Länge (nur diese Render-Kopie wird gekürzt). */
const TITLE_FONT_SIZE = 72;
const TITLE_LINE_SPACING = 14;
const TITLE_MAX_CHARS = 18;
const TITLE_BOTTOM = 860;
const INTRO_ACCENT_Y = 896;
/** Beschreibung: kleiner als der Titel, weiß, links-bündig, top-anchored unter
 *  dem Akzent. Auf REEL_DESCRIPTION_MAX_CHARS gekürzt (≤ ~4 gewrappte Zeilen) →
 *  endet weit oberhalb der unten gepinnten Tagline. */
const DESCRIPTION_FONT_SIZE = 38;
const DESCRIPTION_LINE_SPACING = 12;
const DESCRIPTION_MAX_CHARS = 36;
const DESCRIPTION_TOP = 952;
/** Reel-Intro kürzt eine lange KI-Beschreibung auf diese Länge (die Web-Story
 *  bleibt voll). ~140 Zeichen ≈ ≤ 4 gewrappte Zeilen bei DESCRIPTION_MAX_CHARS. */
const REEL_DESCRIPTION_MAX_CHARS = 140;
/** Tagline FEST nahe dem unteren Rand (bottom-anchored), unabhängig von der
 *  Beschreibungslänge → kein Überlapp. */
const TAGLINE_FONT_SIZE = 34;
const TAGLINE_LINE_SPACING = 8;
const TAGLINE_MAX_CHARS = 32;
const TAGLINE_BOTTOM = 1760;
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

/**
 * Beschreibung NUR fürs Reel-Intro auf eine sichere Maximallänge kürzen (8b-2c):
 * eine lange KI-Beschreibung darf nicht in die unten gepinnte Tagline-Zone wachsen.
 * Am letzten Wortende vor dem Limit schneiden (kein abgehacktes Wort), Satz-/
 * Trennzeichen am Ende strippen, „…" anhängen. Kurze Beschreibungen bleiben
 * unverändert. Die in `booklets` gespeicherte intro_description wird NICHT
 * angefasst — nur diese Render-Kopie wird gekürzt; die Web-Story nutzt die volle
 * Länge.
 */
function truncateForIntro(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  // Nur am Wortende schneiden, wenn dabei nicht zu viel verloren geht; sonst hart.
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s.,;:!?…–—-]+$/u, "")}…`;
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
 * GETEILTE Overlay-Kette für Foto-Frames UND Video-Clips (8b-1b/1c/2b): erzeugt
 * über einem bestehenden Video-Stream-Label (`baseLabel`) den Caption-Scrim (unten)
 * + Branding-Akzentbalken + Caption-drawtext, wenn `caption` gesetzt ist, und/oder
 * ein dezentes Logo-Wasserzeichen (obere Ecke), wenn `logoPath` gesetzt ist. Sind
 * beide null ⇒ leeres Ergebnis (kein Overlay, `outLabel === baseLabel`).
 *
 * Liefert die zusätzlichen `-i`-Inputs (Scrim, dann Logo — ab `firstExtraInputIdx`
 * in GENAU dieser Reihenfolge), die filter_complex-Teile und das End-Label. Der
 * Foto- (`bakePhotoFrame`) und der Video-Pfad (`normalizeClip`) teilen sich damit
 * EXAKT dieselbe Overlay-Logik (kein Drift, keine Duplikation); der einzige
 * Unterschied bleibt der Basis-Stream (Foto-Still vs. normalisierter Clip) und das
 * anschließende Encoding.
 *
 * Über einem Video-Stream zeigt das Overlay STATISCH über die volle Clip-Dauer:
 * die Scrim-/Logo-PNGs sind Einzelbilder, `overlay` (eof_action=repeat, Default)
 * hält sie für jeden Frame; `drawtext` ohne `enable=` rendert auf jedem Frame.
 *
 * 6.0.1-sicher (wie die Foto-Caption seit 8b-1b/1c): literales `x`, links-bündig,
 * KEINE zentrierten `(…)/2`-Ausdrücke; Text via `textfile`/`fontfile` (kein
 * fontconfig), Escaping erledigt die textfile (`expansion=none`).
 */
async function buildCaptionOverlay({
  caption,
  logoPath,
  accent,
  baseLabel,
  firstExtraInputIdx,
  textfiles,
  logoPosition = "topleft",
}: {
  caption: string | null;
  logoPath: string | null;
  accent: string;
  baseLabel: string;
  firstExtraInputIdx: number;
  textfiles: string[];
  /** Wo das Logo-Wasserzeichen sitzt. Default `'topleft'` → Kunden-Reel unverändert.
   *  `'topright'` → kleinere Box (280×80) rechts oben, kein Konflikt mit dem
   *  VORHER/NACHHER-Label (das sitzt links oben). */
  logoPosition?: "topleft" | "topright";
}): Promise<{ extraInputs: string[]; parts: string[]; outLabel: string }> {
  const extraInputs: string[] = [];
  const parts: string[] = [];
  let idx = firstExtraInputIdx;
  let cur = baseLabel;

  if (caption !== null) {
    extraInputs.push("-i", CAPTION_SCRIM_PATH);
    const scrimIdx = idx++;
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
    extraInputs.push("-i", logoPath);
    const logoIdx = idx++;
    if (logoPosition === "topright") {
      parts.push(
        scaleLogo(`[${logoIdx}:v]`, WATERMARK_TR_BOX_W, WATERMARK_TR_BOX_H, "[wm]"),
      );
      parts.push(`[${cur}][wm]overlay=W-w-${WATERMARK_MARGIN}:${WATERMARK_MARGIN}[out]`);
    } else {
      parts.push(scaleLogo(`[${logoIdx}:v]`, WATERMARK_BOX_W, WATERMARK_BOX_H, "[wm]"));
      parts.push(`[${cur}][wm]overlay=${WATERMARK_MARGIN}:${WATERMARK_MARGIN}[out]`);
    }
    cur = "out";
  }

  return { extraInputs, parts, outLabel: cur };
}

/**
 * Ein Foto-Frame (1080x1920) backen: cover-crop; optional Caption-Overlay
 * (Scrim + Akzentbalken + drawtext, 8b-1b) und/oder Logo-Wasserzeichen oben links
 * (8b-1c, nur bei logo_per_page). Ohne beides bleibt das Foto sauber (kein Scrim).
 * Die Overlay-Kette teilt sich `buildCaptionOverlay` mit dem Clip-Pfad (8b-2b).
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
    // Foto = Input 0; Scrim/Logo folgen ab Index 1. Die Overlay-Kette ist mit dem
    // Clip-Pfad geteilt (buildCaptionOverlay) — identische Filtergraph-Strings.
    const { extraInputs, parts: overlayParts, outLabel } = await buildCaptionOverlay({
      caption,
      logoPath,
      accent,
      baseLabel: "base",
      firstExtraInputIdx: 1,
      textfiles,
    });
    const parts = [`[0:v]${COVER}[base]`, ...overlayParts];

    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        input,
        ...extraInputs,
        "-filter_complex",
        parts.join(";"),
        "-map",
        `[${outLabel}]`,
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
 * Intro-Frame (1080x1920) backen (8b-1c/2c): Hintergrund (Bild cover-crop oder
 * Verlauf) → Vollflächen-Scrim → Logo prominent oben (zentriert) → Titel (groß,
 * links-bündig) → Akzentbalken → Beschreibung (1–2 Sätze, die persönliche
 * Ich-Story, gekürzt) → Tagline FEST nahe dem unteren Rand.
 *
 * 8b-2c (Überlapp-Fix): Die Beschreibung wird NUR hier (beim Rendern) auf
 * REEL_DESCRIPTION_MAX_CHARS gekürzt und die Tagline ist bottom-anchored — so
 * wächst eine lange KI-Beschreibung nie in die Tagline. Die gespeicherte
 * intro_description bleibt unberührt (Web-Story nutzt die volle Länge). Alle
 * drawtext links-bündig mit literalem x (auf 6.0.1 bewährt).
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
        wrapText(
          truncateForIntro(description, REEL_DESCRIPTION_MAX_CHARS),
          DESCRIPTION_MAX_CHARS,
        ),
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
          y: `${TAGLINE_BOTTOM}-text_h`,
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
 * KANONISCHE Reel-Form, die ALLE Segmente (Stills wie Clips) tragen MÜSSEN, sonst
 * bricht der concat-Demuxer (-c copy): 30 fps (CFR), yuv420p, libx264, KEIN Audio.
 * `setsar=1` ist in `COVER` enthalten bzw. wird beim Still gesetzt.
 */
const CANON_ENCODE = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-an"] as const;

/**
 * Gebackenes Still-PNG (Intro/Foto/Outro) → normalisiertes mp4-Segment (8b-2a):
 * das Bild wird `seconds` lang geloopt (`-loop 1 -t s`) und auf die KANONISCHE
 * Reel-Form encodet. Diese Form ist identisch zu `normalizeClip` — Voraussetzung
 * fürs verlustfreie Zusammenfügen per concat-Demuxer (s. `concatSegments`).
 */
export async function encodeStillSegment({
  ffmpegBin,
  image,
  seconds,
  output,
}: {
  ffmpegBin: string;
  image: string;
  seconds: number;
  output: string;
}): Promise<void> {
  await execFileAsync(
    ffmpegBin,
    [
      "-y",
      "-nostdin",
      "-loglevel",
      "error",
      "-loop",
      "1",
      "-t",
      String(seconds),
      "-i",
      image,
      "-vf",
      `setsar=1,fps=${REEL_FPS},format=yuv420p`,
      ...CANON_ENCODE,
      output,
    ],
    { timeout: SEGMENT_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
  );
}

/**
 * Video-Clip → KANONISCHES mp4-Segment (8b-2a/2b), IDENTISCH zu den Foto-Segmenten:
 *  - cover-crop auf 1080×1920 (`COVER`; autorotate greift VOR den Filtern → auch
 *    Hochformat-Handyclips werden korrekt aufgerichtet),
 *  - 30 fps (CFR via `fps`-Filter), yuv420p, libx264,
 *  - **Audio gestrippt** (`-an`) — das Reel ist mute-safe (der Text trägt die Story),
 *  - Dauer auf **min(Clip-Länge, maxSeconds)** gecappt: `-t` als INPUT-Option stoppt
 *    das Lesen nach maxSeconds (kürzere Clips laufen bis EOF). Tempo; in 8b-3
 *    konfigurierbar.
 *
 * 8b-2b: trägt jetzt DIESELBE Overlay-Kette wie das Foto (`buildCaptionOverlay`) —
 * Caption (`displayCaption` ⇒ caption ?? keyword; beide leer ⇒ KEIN Overlay) plus
 * optionales Logo-Wasserzeichen (logo_per_page), STATISCH über die volle Clip-Dauer
 * (kein `enable=`) in den Video-Stream gebrannt. Ohne beides bleibt der schnelle
 * 8b-2a-Pfad (nacktes `-vf`). Die kanonische Form ändert sich NICHT (1080×1920,
 * 30 fps CFR, yuv420p, h264, SAR 1:1, stumm) — Voraussetzung fürs concat-Fügen.
 */
export async function normalizeClip({
  ffmpegBin,
  input,
  maxSeconds,
  output,
  caption,
  logoPath,
  primaryColor,
  logoPosition = "topleft",
}: {
  ffmpegBin: string;
  input: string;
  maxSeconds: number;
  output: string;
  caption: string | null;
  logoPath: string | null;
  primaryColor: string;
  logoPosition?: "topleft" | "topright";
}): Promise<void> {
  const accent = ffmpegColor(primaryColor, DEFAULT_BRANDING.primary_color);
  const textfiles: string[] = [];

  // Schneller Pfad: nackter Clip ohne Caption/Wasserzeichen → einfaches -vf
  // (Verhalten von 8b-2a unverändert).
  if (caption === null && !logoPath) {
    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        "-t",
        String(maxSeconds),
        "-i",
        input,
        "-vf",
        `${COVER},fps=${REEL_FPS},format=yuv420p`,
        ...CANON_ENCODE,
        output,
      ],
      { timeout: SEGMENT_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
    );
    return;
  }

  // Overlay-Pfad (8b-2b): cover-crop + 30 fps auf dem Clip, dann die GETEILTE
  // Overlay-Kette (Scrim + Caption + optionales Wasserzeichen) über den Video-
  // Stream, zuletzt format=yuv420p. Identische kanonische Form wie der schnelle
  // Pfad und die Foto-Segmente — sonst bricht der concat-Demuxer (-c copy).
  try {
    const { extraInputs, parts: overlayParts, outLabel } = await buildCaptionOverlay({
      caption,
      logoPath,
      accent,
      baseLabel: "base",
      firstExtraInputIdx: 1,
      textfiles,
      logoPosition,
    });
    const parts = [
      `[0:v]${COVER},fps=${REEL_FPS}[base]`,
      ...overlayParts,
      `[${outLabel}]format=yuv420p[v]`,
    ];

    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        // `-t` VOR `-i input` → cappt nur den Clip; Scrim/Logo sind Standbilder
        // (overlay eof_action=repeat hält sie über die volle Dauer).
        "-t",
        String(maxSeconds),
        "-i",
        input,
        ...extraInputs,
        "-filter_complex",
        parts.join(";"),
        "-map",
        "[v]",
        ...CANON_ENCODE,
        output,
      ],
      { timeout: SEGMENT_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
    );
  } finally {
    await unlinkAll(textfiles);
  }
}

/** Label-Boxfarben/-Maße für VORHER/NACHHER (bakeBusinessPhotoFrame). */
const LABEL_FONT_SIZE = 130;
const LABEL_Y = 80;
const LABEL_BOX_BORDER_W = 36;
const LABEL_BEFORE_COLOR = "0x3A3A3A"; // Anthrazit
// NACHHER-Farbe kommt aus primaryColor (ffmpegColor-konvertiert).
/**
 * Geschätzter Vorschub je Großbuchstabe (Anteil der Fontgröße) zum horizontalen
 * ZENTRIEREN des VORHER/NACHHER-Labels. Plus Jakarta Sans SemiBold liegt für
 * Versalien bei ~0,66. Daraus wird die Labelbreite geschätzt und x in JS als
 * LITERAL berechnet — NIE als ffmpeg-Ausdruck `(w-text_w)/2` (rendert auf dem
 * Production-Build 6.0.1 STILL NICHTS, s. accentBar-Bugfix oben). Perfekte
 * Zentrierung ist unkritisch (kein Logo daneben) — optisch mittig genügt.
 */
const LABEL_CHAR_WIDTH_FACTOR = 0.66;

/**
 * Business-Foto-Frame (1080×1920) backen — Variante für das Betriebs-IG-Reel
 * (0013, renderBusinessReel). Unterscheidet sich von `bakePhotoFrame` in zwei
 * Punkten:
 *
 *  1. Logo rechts oben (via `buildCaptionOverlay` mit `logoPosition:'topright'`,
 *     kleinere Box 280×80) statt links oben — kein Konflikt mit dem Label.
 *
 *  2. Optionales VORHER/NACHHER-Label (`label`: `'VORHER'` | `'NACHHER'`):
 *     `drawtext` mit `box=1` (gefülltes Rechteck), oben ZENTRIERT (x in JS als
 *     LITERAL geschätzt, y=80), 130px, uppercase, weiß auf Anthrazit (VORHER)
 *     bzw. `primaryColor` (NACHHER), `boxborderw=36`. Label-drawtext sitzt NACH
 *     dem Caption-Overlay → liegt visuell ganz oben. Kein Label (process-Fotos)
 *     → kein drawtext.
 *
 * Ausgabe: PNG, `-frames:v 1` — identisch zu `bakePhotoFrame`, damit
 * `encodeStillSegment` + `concatSegments` direkt wiederverwendet werden können.
 *
 * 6.0.1-sicher: literales `x`/`y`, `textfile`/`fontfile`, `expansion=none`.
 */
export async function bakeBusinessPhotoFrame({
  ffmpegBin,
  input,
  output,
  caption,
  logoPath,
  primaryColor,
  label,
}: {
  ffmpegBin: string;
  input: string;
  output: string;
  caption: string | null;
  logoPath: string | null;
  primaryColor: string;
  label?: "VORHER" | "NACHHER";
}): Promise<void> {
  const accent = ffmpegColor(primaryColor, DEFAULT_BRANDING.primary_color);
  const textfiles: string[] = [];

  // Schneller Pfad: sauberes Foto ohne Caption, Logo oder Label.
  if (caption === null && !logoPath && !label) {
    await execFileAsync(
      ffmpegBin,
      ["-y", "-nostdin", "-loglevel", "error", "-i", input, "-vf", COVER, "-frames:v", "1", output],
      { timeout: FRAME_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
    );
    return;
  }

  try {
    // Caption-Overlay + Logo rechts oben (logoPosition:'topright').
    const { extraInputs, parts: overlayParts, outLabel } = await buildCaptionOverlay({
      caption,
      logoPath,
      accent,
      baseLabel: "base",
      firstExtraInputIdx: 1,
      textfiles,
      logoPosition: "topright",
    });
    const parts = [`[0:v]${COVER}[base]`, ...overlayParts];

    // VORHER/NACHHER-Label oben ZENTRIERT, NACH dem Caption-Overlay.
    let finalLabel = outLabel;
    if (label) {
      const labelFile = await writeTmpText(label, textfiles);
      const boxcolor =
        label === "NACHHER" ? `${accent}@1.0` : `${LABEL_BEFORE_COLOR}@1.0`;
      // x als LITERAL in JS zentrieren — KEIN ffmpeg-Ausdruck `(w-text_w)/2`
      // (rendert auf dem Production-Build 6.0.1 still nichts). Der Box-Rand ist
      // symmetrisch ⇒ zentrierter Text zentriert auch die Box.
      const estWidth = label.length * LABEL_FONT_SIZE * LABEL_CHAR_WIDTH_FACTOR;
      const labelX = Math.max(0, Math.round((REEL_W - estWidth) / 2));
      const labelDraw =
        `drawtext=textfile=${labelFile}:fontfile=${FONT_PATH}:expansion=none:` +
        `fontcolor=white:fontsize=${LABEL_FONT_SIZE}:line_spacing=0:` +
        `x=${labelX}:y=${LABEL_Y}:` +
        `box=1:boxcolor=${boxcolor}:boxborderw=${LABEL_BOX_BORDER_W}:` +
        `shadowcolor=black@0.55:shadowx=0:shadowy=2`;
      parts.push(`[${outLabel}]${labelDraw}[lbl]`);
      finalLabel = "lbl";
    }

    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        input,
        ...extraInputs,
        "-filter_complex",
        parts.join(";"),
        "-map",
        `[${finalLabel}]`,
        "-frames:v",
        "1",
        output,
      ],
      { timeout: FRAME_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
    );
  } catch (err) {
    console.error("bakeBusinessPhotoFrame failed", {
      step: "bake",
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    await unlinkAll(textfiles);
  }
}

/**
 * Formatgleiche Segmente → 9:16-Reel via **concat-Demuxer** (8b-2a): eine
 * Dateiliste (`file '…'` je Zeile) wird mit `-f concat -safe 0` gelesen und mit
 * **`-c copy`** (KEIN Re-Encode) zusammengefügt — schnell und robust, SOLANGE alle
 * Segmente dieselben Codec-/Format-Parameter tragen (Auflösung, yuv420p, h264,
 * 30 fps, SAR 1:1). Genau das stellen `encodeStillSegment`/`normalizeClip` sicher;
 * driften die Parameter, bricht der Demuxer. HARTE Schnitte (kein Übergang),
 * `+faststart` aufs Endprodukt. Reihenfolge der Liste = Reihenfolge im Reel
 * (Intro → Items in sort_order → Outro).
 */
export async function concatSegments({
  ffmpegBin,
  segments,
  output,
}: {
  ffmpegBin: string;
  segments: string[];
  output: string;
}): Promise<void> {
  // concat-Demuxer braucht eine Dateiliste; Single-Quotes im Pfad defensiv escapen
  // (unsere /tmp-UUID-Pfade enthalten zwar keine, aber sicher ist sicher).
  const listBody = segments
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  const listPath = join(tmpdir(), `concat-${randomUUID()}.txt`);
  await writeFile(listPath, `${listBody}\n`, "utf8");
  try {
    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-nostdin",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: CONCAT_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER },
    );
  } finally {
    await unlink(listPath).catch(() => {});
  }
}
