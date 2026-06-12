import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeSettings } from "@/lib/auth/current-business";
import { bookletShareLink } from "@/lib/booklet/share-link";
import { sendBookletEmail } from "@/lib/email/booklet-email";
import { generateShortSummary } from "@/lib/ai/short-summary";
import { classifyEvent, parseWebhookBody } from "@/lib/roapp/events";
import {
  getRoappOrder,
  ROAPP_PICKED_UP_STATUS_NAME,
  type RoappOrder,
} from "@/lib/roapp/client";

/**
 * POST /api/webhook/[secret] — vendor-neutraler Inbound-Webhook (§12).
 *
 * Liegt bewusst NICHT unter /portal: kein Session-Kontext. Die Authentifizierung
 * ist das PFAD-SECRET: `[secret]` → `businesses.webhook_secret` → `business_id`.
 * Diese `business_id` ist die EINZIGE Vertrauensquelle (§14.2) — NIE aus dem
 * Payload. Ohne Session laufen ALLE DB-Zugriffe über `service_role`, strikt auf
 * die aufgelöste `business_id` gescoped.
 *
 * Zwei Events (vendor-neutral klassifiziert, roapp-spezifisch angereichert):
 *  - order.created  (event_name endet auf ".created")        → Order anlegen.
 *  - order.picked_up(event_name endet auf ".status.changed") → falls API-
 *    `status.name === ROAPP_PICKED_UP_STATUS_NAME` und unsere Order `generated`
 *    ist: deliver-Pfad replizieren (Status, Billing, E-Mail).
 *
 * Anreicherung: EIN Call `GET /orders/{object_id}` liefert client + status.name +
 * id_label (= external_ref). KEIN zweiter Contact-Call.
 *
 * ROBUSTHEIT (§12): Außer ungültigem Secret (404) IMMER 200 + kurzer
 * Status-String, damit roapp keine Retry-Stürme macht. No-op-Fälle werden
 * geloggt. Die deliver-Logik ist REPLIZIERT (nicht geteilt), weil die
 * Portal-deliver-Route session-gebunden ist.
 *
 * HINWEIS: Die `x-signature` (HMAC) wird im MVP NICHT geprüft — das Pfad-Secret
 * ist die Auth. Signaturprüfung ist als Folgeschritt in TECH.md notiert.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Der über das Secret aufgelöste Betrieb (Vertrauensquelle). */
type WebhookBusiness = {
  id: string;
  name: string;
  default_language: string;
  settings: unknown;
};

/** Echte Fehlermeldung für die Server-Logs (Vercel) extrahieren. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 200 mit kurzem Status-String. Alles außer ungültigem Secret antwortet so —
 * roapp soll nicht erneut zustellen.
 */
function ok(status: string): NextResponse {
  return NextResponse.json({ status }, { status: 200 });
}

/** 404 — das EINZIGE harte Gate: unbekanntes/fehlendes Secret. */
function notFound(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

/**
 * Öffentliche Booklet-Basis-URL für den E-Mail-Link (identische Logik zur
 * deliver-Route). Bevorzugt `BOOKLET_BASE_URL` (Prod: eigene Booklet-Domain,
 * z. B. https://b.valooro.com); Fallback ist der Request-Origin (dev).
 */
function bookletBaseUrl(request: Request): string {
  const configured = process.env.BOOKLET_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params;
  if (!secret) return notFound();

  const service = createServiceClient();

  // AUTH (§14.2): Pfad-Secret → Betrieb. Die EINZIGE Vertrauensquelle.
  const { data: business, error: bizError } = await service
    .from("businesses")
    .select("id, name, default_language, settings")
    .eq("webhook_secret", secret)
    .maybeSingle<WebhookBusiness>();
  if (bizError) {
    // Infrastruktur-Hiccup beim Auflösen — kein Retry-Sturm provozieren (§12).
    console.error("webhook: business lookup failed", {
      step: "secret_lookup",
      message: bizError.message,
    });
    return ok("lookup_failed");
  }
  if (!business) return notFound();

  // Body parsen + Event vendor-neutral klassifizieren.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.error("webhook: invalid json body", {
      business_id: business.id,
      step: "parse_body",
    });
    return ok("bad_body");
  }

  const parsed = parseWebhookBody(body);
  const kind = classifyEvent(parsed);
  if (!kind) return ok("ignored_event");
  if (!parsed.objectId) {
    console.error("webhook: missing object_id", {
      business_id: business.id,
      step: "object_id",
    });
    return ok("no_object_id");
  }

  // Anreicherung über die roapp-API (EIN Call: client + status.name + id_label).
  let roappOrder: RoappOrder;
  try {
    roappOrder = await getRoappOrder(parsed.objectId);
  } catch (error) {
    console.error("webhook: roapp enrich failed", {
      business_id: business.id,
      step: "enrich",
      object_id: parsed.objectId,
      message: errMessage(error),
    });
    return ok("enrich_failed");
  }

  const externalRef = roappOrder.id_label;

  if (kind === "created") {
    return handleOrderCreated(service, business, roappOrder, externalRef);
  }
  return handleOrderPickedUp(request, service, business, roappOrder, externalRef);
}

/**
 * order.created: Auftrag im Betrieb anlegen (wie die Portal-Order-Route, aber
 * via service_role). IDEMPOTENT über `external_ref`: existiert die Order schon,
 * kein zweiter Insert. §13.5: `consent_given` IMMER false / `consent_at` null —
 * Consent gehört an den Tresen, kann per Webhook nicht erteilt werden.
 */
async function handleOrderCreated(
  service: ServiceClient,
  business: WebhookBusiness,
  roappOrder: RoappOrder,
  externalRef: string | null,
): Promise<NextResponse> {
  // Idempotenz: existiert schon eine Order mit diesem external_ref im Betrieb?
  // (Nur wenn external_ref vorhanden — ohne ihn lässt sich nicht dedupen.)
  if (externalRef) {
    const { data: existing, error } = await service
      .from("orders")
      .select("id")
      .eq("business_id", business.id)
      .eq("external_ref", externalRef)
      .maybeSingle<{ id: string }>();
    if (error) {
      console.error("webhook: created lookup failed", {
        business_id: business.id,
        step: "created_lookup",
        message: error.message,
      });
      return ok("lookup_failed");
    }
    if (existing) return ok("already_exists");
  }

  const { data: inserted, error: insertError } = await service
    .from("orders")
    .insert({
      business_id: business.id,
      customer_name: buildCustomerName(roappOrder, externalRef),
      customer_email: roappOrder.client?.email ?? null,
      customer_phone: null,
      external_ref: externalRef,
      // Roh-Beschreibungstext aus dem betriebs-spezifischen roapp-Custom-Field
      // (parser-getrimmt, sonst null). BEWUSST unverändert übernommen — die KI
      // filtert ihn erst bei der Generierung (Maße/Zahlen/Kürzel).
      item_description: roappOrder.raw_description,
      language: business.default_language,
      status: "draft",
      consent_given: false, // §13.5: NIE per Webhook
      consent_at: null,
    })
    .select("id")
    .single<{ id: string }>();
  if (insertError || !inserted) {
    console.error("webhook: order insert failed", {
      business_id: business.id,
      step: "created_insert",
      message: insertError?.message ?? "no row returned",
    });
    return ok("insert_failed");
  }

  // ZUSÄTZLICH (nur bei vorhandenem Roh-Text): den Sachtext als analytics_event
  // festhalten (0006). NICHT-BLOCKIEREND wie der Billing-Insert im deliver-Pfad —
  // ein Fehler hier wird geloggt, der Auftrag ist bereits angelegt. business_id
  // aus dem aufgelösten Betrieb (§14.2), NIE aus dem Payload. payload ist PII-FREI
  // (nur Sachtext); external_ref = id_label (technische Referenz). Bei
  // `already_exists` greift der frühe Return oben ⇒ hier wird nie doppelt geschrieben.
  if (roappOrder.raw_description) {
    const { error: analyticsError } = await service
      .from("analytics_events")
      .insert({
        business_id: business.id,
        event_type: "order_description",
        source: "roapp",
        external_ref: externalRef,
        payload: { raw_text: roappOrder.raw_description },
      });
    if (analyticsError) {
      console.error("webhook: analytics insert failed", {
        business_id: business.id,
        step: "analytics_insert",
        external_ref: externalRef,
        message: analyticsError.message,
      });
    }
  }

  // KI-Kurzbeschreibung für die Auftragskachel (nur bei vorhandenem Roh-Text).
  // EINMALIG bei der Anlage erzeugt + gespeichert (NICHT beim Listen-Rendern).
  // NICHT-BLOCKIEREND wie der Analytics-Insert: ein Haiku-Fehler oder ein
  // fehlgeschlagenes Update wird geloggt, der Auftrag bleibt angelegt,
  // short_summary bleibt null. service_role-Update strikt auf die gerade
  // angelegte Order + business_id gescoped (§14.2 — business_id NIE aus Payload).
  if (roappOrder.raw_description) {
    try {
      const summary = await generateShortSummary(
        roappOrder.raw_description,
        business.default_language,
      );
      if (summary) {
        const { error: summaryError } = await service
          .from("orders")
          .update({ short_summary: summary })
          .eq("id", inserted.id)
          .eq("business_id", business.id);
        if (summaryError) {
          console.error("webhook: short_summary update failed", {
            business_id: business.id,
            order_id: inserted.id,
            step: "short_summary_update",
            message: summaryError.message,
          });
        }
      }
    } catch (error) {
      console.error("webhook: short_summary generation failed", {
        business_id: business.id,
        order_id: inserted.id,
        step: "short_summary_generate",
        message: errMessage(error),
      });
    }
  }

  return ok("created");
}

/**
 * Kundenname aus dem eingebetteten roapp-client: first+last, sonst name, sonst
 * external_ref, sonst ein generischer Platzhalter (Spalte ist NOT NULL).
 */
function buildCustomerName(
  order: RoappOrder,
  externalRef: string | null,
): string {
  const full = `${order.client?.first_name ?? ""} ${order.client?.last_name ?? ""}`.trim();
  if (full) return full;
  if (order.client?.name) return order.client.name;
  if (externalRef) return externalRef;
  return "Kunde";
}

/**
 * order.picked_up: NUR wenn der API-`status.name` „abgeholt" bedeutet (nie die
 * numerische Payload-ID). Order per external_ref + business finden; ist sie
 * `generated`, den deliver-Pfad replizieren (Status `generated→sent` defensiv
 * gefiltert + count-Check gegen Doppelversand; sent_at, Billing, E-Mail — alle
 * Nebenwirkungen nicht-blockierend wie im deliver-Vorbild).
 */
async function handleOrderPickedUp(
  request: Request,
  service: ServiceClient,
  business: WebhookBusiness,
  roappOrder: RoappOrder,
  externalRef: string | null,
): Promise<NextResponse> {
  // Status-Erkennung ausschließlich über den API-Klartext.
  if (roappOrder.status?.name !== ROAPP_PICKED_UP_STATUS_NAME) {
    return ok("noop_status");
  }
  if (!externalRef) return ok("order_not_found");

  // Order per external_ref + business (service_role, strikt gescoped).
  const { data: order, error: findError } = await service
    .from("orders")
    .select("id, status, customer_name, customer_email")
    .eq("business_id", business.id)
    .eq("external_ref", externalRef)
    .maybeSingle<{
      id: string;
      status: string;
      customer_name: string;
      customer_email: string | null;
    }>();
  if (findError) {
    console.error("webhook: picked_up lookup failed", {
      business_id: business.id,
      step: "pickedup_lookup",
      message: findError.message,
    });
    return ok("lookup_failed");
  }
  if (!order) return ok("order_not_found");

  // Ausliefern lässt sich nur ein generiertes Booklet. Bei abweichendem Status
  // nach STATUS verzweigen (additiv zum Doppelversand-Schutz weiter unten):
  //
  //  - draft/finalized ⇒ noch KEIN versendetes Booklet. Der Kunde hat abgeholt,
  //    aber nichts bekommen ⇒ Warn-Flag `picked_up_at = now()` setzen (treibt den
  //    roten Badge auf der Auftragskachel). KEINE Mail. Idempotent: erneutes
  //    Setzen schadet nicht. (Block C / Schritt 2)
  //  - sent/viewed/shared ⇒ Booklet ist bereits raus. NICHTS tun, KEIN Flag,
  //    KEINE Mail. Reparatur-Rückläufer (Kunde war schon abgeholt, kommt zurück,
  //    wird später erneut „Abgeholt") darf weder warnen noch doppelt mailen.
  if (order.status === "draft" || order.status === "finalized") {
    // §13.5/§14.2: service_role, strikt auf die Order + aufgelöste business_id
    // gescoped — NIE aus dem Payload. NICHT-BLOCKIEREND (nur geloggt): scheitert
    // das Update, bleibt der Badge halt aus, der Webhook soll nicht retryen (§12).
    const { error: flagError } = await service
      .from("orders")
      .update({ picked_up_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("business_id", business.id);
    if (flagError) {
      console.error("webhook: pickup flag update failed", {
        business_id: business.id,
        order_id: order.id,
        step: "pickup_flag",
        message: flagError.message,
      });
    }
    return ok("flagged_pickup_pending");
  }
  if (order.status !== "generated") {
    // sent/viewed/shared — bereits ausgeliefert.
    return ok("already_delivered_noop");
  }

  // Booklet (access_token) laden — service_role, auf business_id gescoped.
  const { data: booklet } = await service
    .from("booklets")
    .select("id, access_token, short_code")
    .eq("order_id", order.id)
    .eq("business_id", business.id)
    .maybeSingle<{
      id: string;
      access_token: string;
      short_code: string | null;
    }>();
  if (!booklet) {
    console.error("webhook: booklet missing", {
      business_id: business.id,
      order_id: order.id,
      step: "booklet_load",
    });
    return ok("no_booklet");
  }

  const now = new Date().toISOString();

  // 1. Status generated→sent, defensiv gefiltert + count: kein Doppelversand,
  //    wenn der Webhook mehrfach feuert oder ein anderer Pfad parallel liefert.
  // picked_up_at sicherheitshalber mit auf null: liefert ein generierter Auftrag
  // automatisch aus, darf kein Warn-Flag zurückbleiben (Block C / Schritt 2).
  const { count, error: statusError } = await service
    .from("orders")
    .update({ status: "sent", picked_up_at: null }, { count: "exact" })
    .eq("id", order.id)
    .eq("status", "generated");
  if (statusError) {
    console.error("webhook: status update failed", {
      business_id: business.id,
      order_id: order.id,
      step: "status_update",
      message: statusError.message,
    });
    return ok("status_failed");
  }
  if (!count) {
    // Race verloren — bereits ausgeliefert. Keine Nebenwirkungen wiederholen.
    return ok("already_sent");
  }

  // 2. booklets.sent_at (nicht-blockierend).
  const { error: sentError } = await service
    .from("booklets")
    .update({ sent_at: now })
    .eq("id", booklet.id)
    .eq("business_id", business.id);
  if (sentError) {
    console.error("webhook: sent_at update failed", {
      business_id: business.id,
      order_id: order.id,
      step: "sent_at_update",
      message: sentError.message,
    });
  }

  // 3. Billing-Event 'booklet_sent' (service_role — billing_events hat für
  //    authenticated kein INSERT-Grant). Nicht-blockierend.
  const { error: billingError } = await service.from("billing_events").insert({
    business_id: business.id,
    booklet_id: booklet.id,
    order_id: order.id,
    event_type: "booklet_sent",
  });
  if (billingError) {
    console.error("webhook: billing insert failed", {
      business_id: business.id,
      order_id: order.id,
      step: "billing_insert",
      message: billingError.message,
    });
  }

  // 4. Booklet-E-Mail (nur wenn customer_email). NICHT-BLOCKIEREND.
  let emailSent = false;
  if (order.customer_email) {
    try {
      const settings = normalizeSettings(business.settings);
      const base = bookletBaseUrl(request);
      // Block C: Kurzlink (Fallback langer Link für alte Booklets), Kunden-Sicht.
      const bookletUrl = bookletShareLink({
        base,
        accessToken: booklet.access_token,
        shortCode: booklet.short_code,
        customerView: true,
      });
      await sendBookletEmail({
        to: order.customer_email,
        customerName: order.customer_name,
        businessName: business.name,
        bookletUrl,
        replyTo: settings.contact_email ?? undefined,
      });
      emailSent = true;
    } catch (error) {
      console.error("webhook: email send failed", {
        business_id: business.id,
        order_id: order.id,
        step: "email",
        message: errMessage(error),
      });
    }
  }

  return ok(emailSent ? "sent" : "sent_no_email");
}
