import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { bookletShareLink } from "@/lib/booklet/share-link";
import { deliverBooklet } from "@/lib/delivery/deliver-booklet";

/**
 * Öffentliche Booklet-Basis-URL für den E-Mail-Link. Bevorzugt die explizite
 * `BOOKLET_BASE_URL` (in Prod laufen Booklets ggf. unter eigener Domain, z. B.
 * `https://b.valooro.com`); Fallback ist der Origin des aktuellen Requests
 * (dev: Portal + Booklet teilen sich den Host). Trailing-Slashes entfernt.
 */
function bookletBaseUrl(request: Request): string {
  const configured = process.env.BOOKLET_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * POST /api/portal/orders/[id]/deliver — der manuelle Auslieferungs-Pfad
 * (Schritt 9c-1, Kanal-Logik Feature 3a): Auftrag → `sent`, Billing-Event,
 * Versand des Booklet-Links an den Kunden über den passenden Kanal — E-Mail
 * bevorzugt, sonst SMS (BulkSMS), sonst kein Kontakt (QR-Fallback). Keine
 * Migration (Spalten/Tabellen aus 0001).
 *
 * Guards (alle vor dem Schreiben):
 *  - AUTHENTICATED Server-Client; kein User ⇒ 401, kein Betrieb ⇒ 403.
 *  - Order über RLS geladen (fremde/fehlende id ⇒ 404).
 *  - Status MUSS `generated` sein (Booklet existiert) ⇒ sonst 409.
 *  - Booklet vorhanden ⇒ sonst 500 `no_booklet` (sollte bei `generated` nie passieren).
 *
 * ISOLATION (§14.2): `business_id` stammt AUSSCHLIESSLICH aus der RLS-geladenen
 * Order (Session-Betrieb), NIE aus dem Body. Status-Update (orders) + sent_at
 * (booklets) laufen über den AUTHENTICATED Client (RLS-Policies decken update).
 * Der Billing-Event-Insert läuft über `service_role`, weil `billing_events` für
 * `authenticated` KEIN INSERT-Grant hat (0001: nur SELECT; Schreiben serverseitig)
 * — strikt auf die Order-`business_id` gescoped.
 *
 * Der Versand (E-Mail/SMS) ist NICHT-BLOCKIEREND: ein Fehlschlag landet als
 * `{ delivery: { channel, ok:false, error } }` in der Antwort, der Auftrag gilt
 * trotzdem als ausgeliefert (`sent` steht). Die Kanal-Wahl liegt in der
 * geteilten `deliverBooklet`-Logik. Der Webhook-Auto-Pfad (3b) bleibt unberührt.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const business = await getCurrentBusiness();
  if (!business) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Order über RLS laden — fremde/fehlende id ⇒ 404. business_id ist hier
  // vertrauenswürdig (Session-Betrieb), Quelle für den service_role-Write.
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, business_id, status, customer_name, customer_email, customer_phone, external_ref, language",
    )
    .eq("id", orderId)
    .maybeSingle<{
      id: string;
      business_id: string;
      status: string;
      customer_name: string;
      customer_email: string | null;
      customer_phone: string | null;
      external_ref: string | null;
      language: string;
    }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Nur ein generiertes Booklet lässt sich ausliefern.
  if (order.status !== "generated") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  // Booklet (access_token) über RLS laden — Mitglieder dürfen booklets lesen.
  const { data: booklet } = await supabase
    .from("booklets")
    .select("id, access_token, short_code")
    .eq("order_id", order.id)
    .maybeSingle<{
      id: string;
      access_token: string;
      short_code: string | null;
    }>();
  if (!booklet) {
    console.error("deliver: booklet missing", {
      order_id: order.id,
      step: "booklet_load",
    });
    return NextResponse.json({ error: "no_booklet" }, { status: 500 });
  }

  const now = new Date().toISOString();

  // 1. Order-Status → sent (defensiv auf `generated` gefiltert: kein
  //    Doppel-Versand bei Races; ein zweiter Klick trifft 0 Zeilen). picked_up_at
  //    mit auf null: ein etwaiges Warn-Flag „abgeholt, noch nicht versendet"
  //    (Block C / Schritt 2) verschwindet, sobald nachversendet wurde.
  //    `count: "exact"` (REVIEW 3.1): bei Doppelklick/Race passieren zwei Requests
  //    den `generated`-Guard oben, der erste setzt `sent`, der zweite trifft 0
  //    Zeilen — exakt wie der Webhook-Pfad (handlePickedUp) frühzeitig abbrechen,
  //    BEVOR Billing-Event + Kunden-E-Mail ein zweites Mal laufen.
  const { count, error: statusError } = await supabase
    .from("orders")
    .update({ status: "sent", picked_up_at: null }, { count: "exact" })
    .eq("id", order.id)
    .eq("status", "generated");
  if (statusError) {
    console.error("deliver: order status update failed", {
      order_id: order.id,
      step: "status_update",
      message: statusError.message,
    });
    return NextResponse.json({ error: "status_failed" }, { status: 500 });
  }
  if (!count) {
    // Race verloren — bereits ausgeliefert. Keine Nebenwirkungen (Billing/E-Mail)
    // wiederholen; aus Aufrufer-Sicht ist der Auftrag versendet.
    return NextResponse.json({ sent: true, alreadySent: true }, { status: 200 });
  }

  // 2. booklets.sent_at = now (AUTHENTICATED, booklets_update). Nicht-blockierend:
  //    der Auftrag gilt bereits als ausgeliefert; ein Fehler hier wird nur geloggt.
  const { error: sentError } = await supabase
    .from("booklets")
    .update({ sent_at: now })
    .eq("id", booklet.id)
    .eq("business_id", order.business_id);
  if (sentError) {
    console.error("deliver: booklet sent_at update failed", {
      order_id: order.id,
      step: "sent_at_update",
      message: sentError.message,
    });
  }

  // 3. Billing-Event (event_type 'booklet_sent') über service_role — billing_events
  //    hat für authenticated KEIN INSERT-Grant (0001). business_id aus der Order.
  //    Nicht-blockierend: der Auftrag ist bereits ausgeliefert; ein Fehler hier
  //    wird laut geloggt (Abrechnung manuell nachziehbar), bricht aber nicht ab.
  const service = createServiceClient();
  const { error: billingError } = await service.from("billing_events").insert({
    business_id: order.business_id,
    booklet_id: booklet.id,
    order_id: order.id,
    event_type: "booklet_sent",
  });
  if (billingError) {
    console.error("deliver: billing event insert failed", {
      order_id: order.id,
      step: "billing_insert",
      message: billingError.message,
    });
  }

  // 4. Versand über den passenden Kanal (Feature 3a): E-Mail bevorzugt, sonst
  //    SMS (BulkSMS), sonst kein Kontakt. NICHT-BLOCKIEREND — der Auftrag gilt
  //    bereits als ausgeliefert (`sent` steht); das Ergebnis (Kanal + ggf.
  //    Fehlergrund) wandert in die Antwort, damit der Operator sieht, was passiert
  //    ist. QR-Pfad (9c-2) bleibt der Fallback ohne Kontakt.
  const base = bookletBaseUrl(request);
  // Block C: kurzer Kurzlink (Fallback auf den langen /b/-Link für alte
  // Booklets ohne Code). customerView=true → ?c=1 (volle Kunden-Sicht).
  const bookletUrl = bookletShareLink({
    base,
    accessToken: booklet.access_token,
    shortCode: booklet.short_code,
    customerView: true,
  });
  const delivery = await deliverBooklet(order, business, bookletUrl, supabase);
  if (!delivery.ok && delivery.channel !== "none") {
    console.error("deliver: send failed", {
      order_id: order.id,
      step: "send",
      channel: delivery.channel,
      message: delivery.error ?? "unknown",
    });
  }

  return NextResponse.json(
    {
      sent: true,
      delivery: {
        channel: delivery.channel,
        ok: delivery.ok,
        ...(delivery.error ? { error: delivery.error } : {}),
      },
    },
    { status: 200 },
  );
}
