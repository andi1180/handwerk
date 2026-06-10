import { Inter, Lora, Manrope, Plus_Jakarta_Sans } from "next/font/google";
import type { FontOption } from "@/lib/settings/options";

/**
 * Lädt die vier wählbaren Branding-Schriften (FONT_OPTIONS) für die öffentliche
 * Web-Story (Schritt 8a-2). `next/font` selbst-hostet die Fonts (kein
 * Layout-Shift, keine externe Anfrage); `preload: false` verhindert, dass alle
 * vier eager geladen werden — der Browser holt nur die Schrift, deren className
 * tatsächlich auf den Story-Container gesetzt wird (s. `bookletFontClass`).
 *
 * Gewichte 400/600/700 decken Fließtext, Semibold und Headline ab — als
 * Literal-Array je Aufruf, weil `next/font` die Werte build-time statisch liest.
 */
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  preload: false,
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  preload: false,
});
const lora = Lora({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  preload: false,
});
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  preload: false,
});

/** FontOption → generierte `next/font`-className (setzt `font-family` direkt). */
const FONT_CLASS: Record<FontOption, string> = {
  "Plus Jakarta Sans": plusJakartaSans.className,
  Inter: inter.className,
  Lora: lora.className,
  Manrope: manrope.className,
};

/** className der gewählten Branding-Schrift für den Story-Wurzel-Container. */
export function bookletFontClass(font: FontOption): string {
  return FONT_CLASS[font];
}
