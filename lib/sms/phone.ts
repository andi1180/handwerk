/**
 * Telefon-Normalisierung auf BulkSMS-MSISDN (Feature 3a — SMS-Versand).
 *
 * Freitext-Nummern (so wie sie aus roapp oder vom Tresen kommen) → MSISDN:
 * reine Ziffern, beginnend mit der Ländervorwahl, OHNE führendes „+“, OHNE „00“,
 * OHNE führende „0“. BulkSMS erwartet genau dieses Format (Beispiele:
 * `436645785569`, `491721627058`). Default-Land Österreich (43). Bewusst streng:
 * lässt sich KEIN sinnvolles Muster erkennen, gibt es einen Fehler statt einer
 * Müll-Nummer — wir wollen keine SMS an eine kaputte Nummer schicken.
 *
 * Regeln (in dieser Reihenfolge), nachdem Whitespace, Bindestriche, Klammern,
 * Punkte UND ein evtl. führendes „+“ entfernt wurden:
 *  - „00…“          → „00“ abschneiden (Rest ist schon Ländercode-präfixiert).
 *  - führende „0…“  → führende „0“ durch „43“ ersetzen (Default-Land AT).
 *  - Ziffer 1–9 vorn → bereits MSISDN, unverändert.
 *  - alles andere   → Fehler (kein sinnvolles Muster).
 *
 * Validierung: nur Ziffern, plausible Länge 8–15 — sonst Fehler.
 *
 * Testfälle (verankert):
 *  - „0664 578 5569“   → „436645785569“
 *  - „+43 664 5785569“ → „436645785569“
 *  - „00436645785569“  → „436645785569“
 *  - „436645785569“    → „436645785569“ (unverändert)
 *  - „491721627058“    → „491721627058“ (unverändert, DE)
 *  - „abc“ / „“        → Fehler
 *
 * Plain-Modul (kein Secret/Server-Bindung) — überall importierbar.
 */

/** Default-Ländervorwahl (Österreich), ohne führendes „+“. */
const DEFAULT_COUNTRY_CODE = "43";

export type PhoneNormalizeResult =
  | { ok: true; msisdn: string }
  | { ok: false; error: string };

/**
 * Normalisiert eine Freitext-Telefonnummer auf BulkSMS-MSISDN (8–15 Ziffern,
 * ohne „+“). Leere/unbrauchbare Eingabe ⇒ `{ ok: false, error }`.
 */
export function normalizePhone(
  raw: string | null | undefined,
): PhoneNormalizeResult {
  if (!raw) return { ok: false, error: "leere Telefonnummer" };

  // Whitespace, Bindestriche, Klammern, Punkte UND ein evtl. führendes „+“ raus.
  const cleaned = raw.replace(/[\s().-]/g, "").replace(/^\+/, "");
  if (cleaned.length === 0) return { ok: false, error: "leere Telefonnummer" };

  // Nach dem Säubern darf nur noch eine reine Ziffernfolge stehen — sonst ist
  // Buchstaben-/Sonderzeichen-Müll drin und wir senden nicht.
  if (!/^\d+$/.test(cleaned)) {
    return { ok: false, error: `kein sinnvolles Telefon-Muster: ${raw}` };
  }

  let msisdn: string;
  if (cleaned.startsWith("00")) {
    // Internationaler Präfix „00“ ⇒ Rest ist bereits Ländercode-präfixiert.
    msisdn = cleaned.slice(2);
  } else if (cleaned.startsWith("0")) {
    // Nationale Nummer mit führender „0“ ⇒ Default-Land AT davorsetzen.
    msisdn = `${DEFAULT_COUNTRY_CODE}${cleaned.slice(1)}`;
  } else {
    // Beginnt mit Ziffer 1–9 ⇒ bereits MSISDN (z. B. „+43…“ nach „+“-Strip).
    msisdn = cleaned;
  }

  if (!/^\d{8,15}$/.test(msisdn)) {
    return { ok: false, error: `ungültige Telefonnummer: ${raw}` };
  }
  return { ok: true, msisdn };
}
