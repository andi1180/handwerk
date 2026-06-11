import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { parseBookletEvent } from "@/lib/booklet/events";

/**
 * POST /api/b/[token]/event — öffentlicher Analytics-Write-Pfad (Schritt 10a).
 *
 * Erfasst Booklet-Interaktionen in `booklet_events` und rückt den Auftragsstatus
 * monoton vorwärts (`sent → viewed → shared`). Keine Migration (Tabelle + Spalten
 * + Status-Enum aus 0001).
 *
 * SICHERHEIT (§14.2): ausschließlich `service_role`. Der TOKEN aus dem URL-Pfad
 * ist die EINZIGE vertrauenswürdige Quelle: token → booklets-Row → `business_id`/
 * `order_id`. NIE ein Client-Wert. Ungültiger Token ⇒ 404, kein Write. Das
 * `event_type`/`channel`-Paar wird serverseitig gegen eine feste Whitelist
 * geprüft (`parseBookletEvent`) — unerlaubte Kombi ⇒ 400, kein Write.
 *
 * `ip_hash`: die Request-IP wird serverseitig gesalzen-gehasht (sha256), nie roh
 * gespeichert.
 *
 * Fire-and-forget: der Client awaitet die Antwort nicht; nicht-kritische Insert-/
 * Update-Fehler werden geloggt, brechen aber nicht ab (Antwort bleibt 200).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Body defensiv parsen.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const parsed = parseBookletEvent(raw.event_type, raw.channel);
  if (!parsed) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const service = createServiceClient();

  // Token → Booklet (access_token ist unique). Vertrauensquelle für
  // business_id/order_id. Nicht gefunden ⇒ 404, kein Write.
  const { data: booklet } = await service
    .from("booklets")
    .select("id, business_id, order_id, viewed_at, first_shared_at")
    .eq("access_token", token)
    .maybeSingle<{
      id: string;
      business_id: string;
      order_id: string;
      viewed_at: string | null;
      first_shared_at: string | null;
    }>();
  if (!booklet) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // 1. Event speichern (service_role — booklet_events hat kein authenticated-
  //    INSERT-Grant). business_id/booklet_id aus der Booklet-Row, nie aus Body.
  const { error: insertError } = await service.from("booklet_events").insert({
    booklet_id: booklet.id,
    business_id: booklet.business_id,
    event_type: parsed.eventType,
    channel: parsed.channel,
    ip_hash: hashIp(request),
  });
  if (insertError) {
    console.error("booklet event: insert failed", {
      order_id: booklet.order_id,
      step: "event_insert",
      message: insertError.message,
    });
  }

  // 2. Lifecycle monoton vorrücken (nie zurück, nie überspringen, defensiv
  //    gefiltert). link_click rückt den Status NICHT vor.
  if (parsed.eventType === "viewed") {
    // sent → viewed (nur wenn aktuell 'sent').
    const { error } = await service
      .from("orders")
      .update({ status: "viewed" })
      .eq("id", booklet.order_id)
      .eq("status", "sent");
    if (error) logLifecycleError(booklet.order_id, "advance_viewed", error.message);

    if (!booklet.viewed_at) {
      await service
        .from("booklets")
        .update({ viewed_at: now })
        .eq("id", booklet.id)
        .is("viewed_at", null);
    }
  } else if (parsed.eventType === "shared") {
    // sent|viewed → shared.
    const { error } = await service
      .from("orders")
      .update({ status: "shared" })
      .eq("id", booklet.order_id)
      .in("status", ["sent", "viewed"]);
    if (error) logLifecycleError(booklet.order_id, "advance_shared", error.message);

    if (!booklet.first_shared_at) {
      await service
        .from("booklets")
        .update({ first_shared_at: now })
        .eq("id", booklet.id)
        .is("first_shared_at", null);
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * Hasht die Request-IP gesalzen (sha256) → nie roh gespeichert. IP aus
 * `x-forwarded-for` (erster Eintrag) bzw. `x-real-ip`; ohne IP ⇒ null.
 * Salt aus `IP_HASH_SALT` (fehlend ⇒ leerer Salt, Hash bleibt deterministisch).
 */
function hashIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0]?.trim()
    : request.headers.get("x-real-ip")?.trim();
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT ?? "";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

function logLifecycleError(orderId: string, step: string, message: string) {
  console.error("booklet event: lifecycle advance failed", {
    order_id: orderId,
    step,
    message,
  });
}
