import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Caption-Overlays im Reel (Schritt 8b-1b) brauchen zur Laufzeit eine
   * EXPLIZIT referenzierte Schrift + ein Scrim-PNG (kein System-/fontconfig-
   * Lookup — der ist auf Vercel leer). Next traced diese Dateien nicht
   * automatisch (sie werden nur per Pfad an ffmpeg übergeben, kein `import`),
   * darum hier gezielt für die render-reel-Route einbinden.
   *
   * Anders als der ffmpeg-Binary-Spike (8b-0, verworfen): das sind KLEINE
   * Dateien (Schrift ~130 KB, Scrim ~10 KB) — kein Größenproblem fürs Deploy.
   * Die Route-Schlüssel sind Globs; `*` deckt das dynamische `[id]` ab, die
   * Bracket-Variante ist ein harmloser Fallback.
   */
  outputFileTracingIncludes: {
    "/api/portal/orders/*/render-reel": [
      "./assets/fonts/PlusJakartaSans-SemiBold.ttf",
      "./assets/reel/caption-scrim.png",
    ],
    "/api/portal/orders/[id]/render-reel": [
      "./assets/fonts/PlusJakartaSans-SemiBold.ttf",
      "./assets/reel/caption-scrim.png",
    ],
  },
};

export default nextConfig;
