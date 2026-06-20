/**
 * Telefon-Normalisierung auf E.164 (Feature 3a — SMS-Versand).
 *
 * Freitext-Nummern (so wie sie aus roapp oder vom Tresen kommen) → E.164, mit
 * Default-Land Österreich (+43). Bewusst streng: lässt sich KEIN sinnvolles
 * Muster erkennen, gibt es einen Fehler statt einer Müll-Nummer — wir wollen
 * keine SMS an eine kaputte Nummer schicken.
 *
 * Regeln (in dieser Reihenfolge):
 *  - Whitespace, Bindestriche, Klammern, Punkte werden entfernt.
 *  - „+…“          → bleibt (internationale Nummer).
 *  - „00…“         → „+…“ (internationaler Präfix).
 *  - führende „0…“ → nationale Nummer ⇒ „+43“ + Rest (Default-Land AT).
 *  - alles andere  → Fehler (kein sinnvolles Muster).
 *
 * Plain-Modul (kein Secret/Server-Bindung) — überall importierbar.
 */

/** Default-Ländervorwahl (Österreich), ohne führendes „+“. */
const DEFAULT_COUNTRY_CODE = "43";

export type PhoneNormalizeResult =
  | { ok: true; e164: string }
  | { ok: false; error: string };

/**
 * Normalisiert eine Freitext-Telefonnummer auf E.164 (`+` + 8–15 Ziffern).
 * Leere/unbrauchbare Eingabe ⇒ `{ ok: false, error }`.
 */
export function normalizePhone(
  raw: string | null | undefined,
): PhoneNormalizeResult {
  if (!raw) return { ok: false, error: "leere Telefonnummer" };

  // Whitespace, Bindestriche, Klammern, Punkte raus.
  const cleaned = raw.replace(/[\s().-]/g, "");
  if (cleaned.length === 0) return { ok: false, error: "leere Telefonnummer" };

  // Nach dem Säubern darf nur noch ein optionales „+“ + Ziffern stehen — sonst
  // ist Buchstaben-/Sonderzeichen-Müll drin und wir senden nicht.
  if (!/^\+?\d+$/.test(cleaned)) {
    return { ok: false, error: `kein sinnvolles Telefon-Muster: ${raw}` };
  }

  let e164: string;
  if (cleaned.startsWith("+")) {
    e164 = cleaned;
  } else if (cleaned.startsWith("00")) {
    e164 = `+${cleaned.slice(2)}`;
  } else if (cleaned.startsWith("0")) {
    e164 = `+${DEFAULT_COUNTRY_CODE}${cleaned.slice(1)}`;
  } else {
    // Reine Ziffern ohne „+“, ohne „00“, ohne führende „0“ ⇒ mehrdeutig.
    return { ok: false, error: `kein sinnvolles Telefon-Muster: ${raw}` };
  }

  if (!/^\+\d{8,15}$/.test(e164)) {
    return { ok: false, error: `ungültige Telefonnummer: ${raw}` };
  }
  return { ok: true, e164 };
}
