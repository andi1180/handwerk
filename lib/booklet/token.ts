import { randomBytes } from "node:crypto";

/**
 * Server-only. Erzeugt den unerratbaren `access_token` eines Booklets
 * (Schritt 8a-1). Der Token ist die einzige vertrauenswürdige Quelle für den
 * späteren öffentlichen Booklet-Read `/b/[token]` (§14.2): Token → Booklet →
 * `business_id`, niemals aus einem Client-Wert abgeleitet.
 *
 * 24 Byte Zufall (192 bit) → base64url (URL-sicher, kein Padding/Slash) erfüllt
 * die DB-Vorgabe „≥ 24 Byte base64url" aus 0001. Dieses Modul darf nur aus
 * Server-Code importiert werden (`node:crypto`).
 */
export function generateAccessToken(): string {
  return randomBytes(24).toString("base64url");
}
