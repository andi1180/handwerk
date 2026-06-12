import { randomBytes } from "node:crypto";

/**
 * Server-only. Erzeugt den kurzen, URL-sicheren Code eines Booklets für den
 * öffentlichen Kurzlink `/s/<code>` (Block C). Anders als der `access_token`
 * (24 Byte, sicherheitskritisch, lib/booklet/token.ts) ist dieser Code nur ein
 * kurzer, abtippbarer Lookup-Schlüssel — die Eindeutigkeit erzwingt das
 * UNIQUE-Constraint in der DB (0008) plus ein Retry bei der Generierung.
 *
 * Alphabet ohne verwechselbare Zeichen (0/O, 1/l/I) → vorlesbar und per Hand
 * abtippbar. 7 Zeichen aus 56 Symbolen ≈ 1.7e12 Kombinationen — bei der
 * erwarteten Booklet-Menge sind Kollisionen extrem selten und werden ohnehin
 * abgefangen. Die leichte Modulo-Verzerrung ist unkritisch (kein Sicherheits-,
 * nur ein Lookup-Code; die DB garantiert die Eindeutigkeit).
 *
 * Dieses Modul darf nur aus Server-Code importiert werden (`node:crypto`).
 */
const SHORT_CODE_ALPHABET =
  "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const SHORT_CODE_LENGTH = 7;

export function generateShortCode(): string {
  let code = "";
  for (const byte of randomBytes(SHORT_CODE_LENGTH)) {
    code += SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length] ?? "";
  }
  return code;
}
