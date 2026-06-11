import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Die Reel-Overlays (Caption 8b-1b, Intro/Outro 8b-1c) brauchen zur Laufzeit
   * eine EXPLIZIT referenzierte Schrift + zwei Scrim-PNGs (kein System-/
   * fontconfig-Lookup — der ist auf Vercel leer). Next traced diese Dateien
   * nicht automatisch (sie werden nur per Pfad an ffmpeg übergeben, kein
   * `import`), darum hier gezielt für die render-reel-Route einbinden.
   *
   *  - caption-scrim.png — Verlauf nur unten (Foto-Captions, 8b-1b).
   *  - frame-scrim.png   — vollflächiger Verlauf (Intro/Outro-Text, 8b-1c).
   *
   * Anders als der ffmpeg-Binary-Spike (8b-0, verworfen): das sind KLEINE
   * Dateien (Schrift ~130 KB, Scrims je ~11 KB) — kein Größenproblem fürs
   * Deploy. Die Route-Schlüssel sind Globs; `*` deckt das dynamische `[id]` ab,
   * die Bracket-Variante ist ein harmloser Fallback.
   */
  outputFileTracingIncludes: {
    "/api/portal/orders/*/render-reel": [
      "./assets/fonts/PlusJakartaSans-SemiBold.ttf",
      "./assets/reel/caption-scrim.png",
      "./assets/reel/frame-scrim.png",
    ],
    "/api/portal/orders/[id]/render-reel": [
      "./assets/fonts/PlusJakartaSans-SemiBold.ttf",
      "./assets/reel/caption-scrim.png",
      "./assets/reel/frame-scrim.png",
    ],
  },
};

export default nextConfig;
