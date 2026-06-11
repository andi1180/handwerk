import type { NextConfig } from "next";

/**
 * Pfad zum gebündelten ffmpeg-Binary (Schritt 8b-0). `ffmpeg-static` lädt zur
 * Install-Zeit das plattformspezifische Binary; auf Vercel (Linux x64) heißt es
 * schlicht `ffmpeg`. Der Wert ist ein Literal-Pfad relativ zum Projekt-Root und
 * löst auch durch den pnpm-Symlink (node_modules/ffmpeg-static → .pnpm/…) sauber
 * auf das echte Binary auf.
 */
const FFMPEG_BINARY = "./node_modules/ffmpeg-static/ffmpeg";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * KRITISCH (8b-0, bekannter Stolperstein): Next.js tracet das ffmpeg-Binary
   * NICHT automatisch in die Serverless-Function — es wird zur Laufzeit über
   * einen berechneten Pfad geladen (kein `require` der Binärdatei), bleibt der
   * statischen Analyse also unsichtbar. Ohne expliziten Eintrag fehlt das Binary
   * auf Vercel zur Laufzeit (`spawn … ENOENT`).
   *
   * Die Schlüssel sind Route-Globs. Das dynamische [id]-Segment wird mit `*`
   * abgedeckt — eckige Klammern würden als Glob-Zeichenklasse fehlinterpretiert.
   * Die bracket-Variante ist als Fallback dabei (je nach Next-Interpretation
   * greift genau eine; die andere matcht nichts und ist harmlos). Bewusst eng
   * auf die Render-Route gescoped, damit die anderen Order-API-Functions nicht
   * mit dem ~45 MB-Binary aufgebläht werden.
   */
  outputFileTracingIncludes: {
    "/api/portal/orders/*/render-reel-test": [FFMPEG_BINARY],
    "/api/portal/orders/[id]/render-reel-test": [FFMPEG_BINARY],
  },
};

export default nextConfig;
