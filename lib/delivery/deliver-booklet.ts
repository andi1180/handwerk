// Nur server-seitig. NIEMALS in Client Components importieren.
import type { createClient } from "@/lib/supabase/server";
import type { CurrentBusiness } from "@/lib/auth/current-business";
import { sendBookletEmail } from "@/lib/email/booklet-email";
import { sendBookletSms } from "@/lib/sms/booklet-sms";

/**
 * Geteilte Auslieferungs-Logik (Feature 3a — Kanal-Wahl). EINE Quelle dafür,
 * über welchen Kanal der Booklet-Link den Kunden erreicht:
 *
 *  1. `customer_email` gesetzt → E-Mail (sendBookletEmail, bestehend).
 *  2. sonst `customer_phone` gesetzt → SMS (sendBookletSms, BulkSMS).
 *  3. sonst → `{ channel: 'none', ok: false }` (kein Kontakt, nichts senden).
 *
 * E-Mail hat Vorrang (rich/Deliverability); SMS ist der Fallback ohne E-Mail.
 *
 * Der Aufrufer (manueller wie Webhook-Auto-Pfad) behandelt das Ergebnis NICHT-
 * BLOCKIEREND: Status-/Billing-/sent_at-Sequenz bleibt unverändert im Route
 * Handler; dieses Modul macht NUR den eigentlichen Versand und meldet das
 * Ergebnis zurück, damit der Operator (bzw. das Log) Kanal/Fehlergrund sieht.
 *
 * Feature 3b: Auch der Webhook-Auto-Pfad nutzt diesen Helfer. Der `business`-
 * Parameter ist daher auf `name` + (normalisierte) `settings` verengt
 * (`Pick<CurrentBusiness, …>`) — der manuelle Pfad reicht eine `CurrentBusiness`
 * durch (strukturell zuweisbar), der Auto-Pfad einen aus `WebhookBusiness` +
 * `normalizeSettings` gebauten Ausschnitt.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Auftragsfelder, die die Auslieferung braucht (strukturell). */
export type DeliverableOrder = {
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  external_ref: string | null;
};

export type DeliveryChannel = "email" | "sms" | "none";

export type DeliveryResult = {
  channel: DeliveryChannel;
  ok: boolean;
  error?: string;
};

/** Echte Fehlermeldung für die Route-Antwort/Logs extrahieren. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Liefert das Booklet über den passenden Kanal aus. `link` ist der bereits
 * gebaute (Kurz-)Kunden-Link (s. `bookletShareLink`).
 *
 * `supabase` ist Teil der einheitlichen Auslieferungs-Signatur (für eine
 * spätere Versand-Persistenz, z. B. SMS-Zustellprotokoll) — aktuell ungenutzt;
 * Status/Billing/sent_at bleiben bewusst im Route Handler.
 */
export async function deliverBooklet(
  order: DeliverableOrder,
  business: Pick<CurrentBusiness, "name" | "settings">,
  link: string,
  supabase: ServerClient,
): Promise<DeliveryResult> {
  void supabase; // reserviert (s. Doc) — kein Zugriff in 3a.

  // 1. E-Mail bevorzugt (sendBookletEmail wirft bei Fehler).
  if (order.customer_email) {
    try {
      await sendBookletEmail({
        to: order.customer_email,
        customerName: order.customer_name,
        businessName: business.name,
        bookletUrl: link,
        replyTo: business.settings.contact_email ?? undefined,
        websiteUrl: business.settings.website_url ?? undefined,
      });
      return { channel: "email", ok: true };
    } catch (error) {
      return { channel: "email", ok: false, error: errMessage(error) };
    }
  }

  // 2. Sonst SMS (sendBookletSms gibt ein Ergebnis zurück, wirft nicht).
  if (order.customer_phone) {
    const result = await sendBookletSms(order, business, link);
    return result.ok
      ? { channel: "sms", ok: true }
      : { channel: "sms", ok: false, error: result.error };
  }

  // 3. Kein Kontakt — nichts senden.
  return { channel: "none", ok: false };
}
