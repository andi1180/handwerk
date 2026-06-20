// Nur server-seitig. NIEMALS in Client Components importieren.
import type { CurrentBusiness } from "@/lib/auth/current-business";
import { normalizePhone } from "./phone";
import { sendSms, type SmsSendResult } from "./bulksms";

/**
 * Booklet-Auslieferungs-SMS (Feature 3a). Baut den Nachrichtentext und versendet
 * ihn über BulkSMS an den Kunden.
 *
 *  - Empfänger = normalisierte `order.customer_phone` (MSISDN, ohne „+“). Lässt
 *    sich die Nummer nicht normalisieren ⇒ kein Versand (`{ ok: false, error }`).
 *  - Absender  = normalisierte `business.settings.contact_phone` (best effort:
 *    normalisiert sie nicht, wird ohne expliziten Absender gesendet — BulkSMS
 *    nutzt dann den Account-Standard).
 *
 * Der Text hat bewusst EXAKTE Zeilenumbrüche + Schreibweise („Spass“/„Grüsse“).
 */

/** Nur die Auftragsfelder, die die SMS braucht (strukturell). */
export type BookletSmsOrder = {
  customer_phone: string | null;
  external_ref: string | null;
};

/**
 * Versendet die Booklet-SMS. `link` ist der bereits gebaute (Kurz-)Link zum
 * Booklet (s. `bookletShareLink`). Gibt das BulkSMS-Ergebnis zurück — wirft nie.
 */
export async function sendBookletSms(
  order: BookletSmsOrder,
  business: CurrentBusiness,
  link: string,
): Promise<SmsSendResult> {
  const recipient = normalizePhone(order.customer_phone);
  if (!recipient.ok) {
    return { ok: false, error: `Empfänger: ${recipient.error}` };
  }

  const sender = normalizePhone(business.settings.contact_phone);

  // EXAKTE Zeilenumbrüche (6 Zeilen, Z. 2 + Z. 5 leer) + Schreibweise.
  const body = [
    business.name.toUpperCase(),
    "",
    `Wir haben für Sie ein Booklet Ihrer Änderung ${order.external_ref ?? ""} angefertigt. Viel Spass beim Ansehen!`,
    link,
    "",
    "Liebe Grüsse!",
  ].join("\n");

  return sendSms({
    to: recipient.msisdn,
    body,
    from: sender.ok ? sender.msisdn : undefined,
  });
}
