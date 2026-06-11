import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { CUSTOMER_VIEW_QUERY } from "@/lib/booklet/customer-view";
import { sendBookletEmail } from "@/lib/email/booklet-email";

/** Echte Fehlermeldung für die Server-Logs (Vercel) extrahieren. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
 * (Schritt 9c-1): Auftrag → `sent`, Billing-Event, E-Mail an den Kunden mit dem
 * Booklet-Link. Keine Migration (Spalten/Tabellen aus 0001).
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
 * E-Mail ist NICHT-BLOCKIEREND: ein Fehlschlag setzt `emailFailed:true`, der
 * Auftrag gilt trotzdem als ausgeliefert (`sent` steht).
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
    .select("id, business_id, status, customer_name, customer_email, language")
    .eq("id", orderId)
    .maybeSingle<{
      id: string;
      business_id: string;
      status: string;
      customer_name: string;
      customer_email: string | null;
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
    .select("id, access_token")
    .eq("order_id", order.id)
    .maybeSingle<{ id: string; access_token: string }>();
  if (!booklet) {
    console.error("deliver: booklet missing", {
      order_id: order.id,
      step: "booklet_load",
    });
    return NextResponse.json({ error: "no_booklet" }, { status: 500 });
  }

  const now = new Date().toISOString();

  // 1. Order-Status → sent (defensiv auf `generated` gefiltert: kein
  //    Doppel-Versand bei Races; ein zweiter Klick trifft 0 Zeilen).
  const { error: statusError } = await supabase
    .from("orders")
    .update({ status: "sent" })
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

  // 4. E-Mail (nur wenn customer_email vorhanden). NICHT-BLOCKIEREND: ein
  //    Fehlschlag ⇒ emailFailed:true, sent steht trotzdem. QR-Pfad folgt (9c-2).
  let emailSent = false;
  let emailFailed = false;
  if (order.customer_email) {
    try {
      const base = bookletBaseUrl(request);
      const bookletUrl = `${base}/b/${booklet.access_token}?${CUSTOMER_VIEW_QUERY}`;
      await sendBookletEmail({
        to: order.customer_email,
        customerName: order.customer_name,
        businessName: business.name,
        bookletUrl,
        replyTo: business.settings.contact_email ?? undefined,
      });
      emailSent = true;
    } catch (error) {
      emailFailed = true;
      console.error("deliver: email send failed", {
        order_id: order.id,
        step: "email",
        message: errMessage(error),
      });
    }
  }

  return NextResponse.json(
    { sent: true, emailSent, ...(emailFailed ? { emailFailed: true } : {}) },
    { status: 200 },
  );
}
