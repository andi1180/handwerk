import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/** Die zurückgegebene (und für die Liste relevante) Medien-Zeile. */
type InsertedMedia = {
  id: string;
  media_type: "photo" | "video";
  storage_path: string;
  keyword: string | null;
  sort_order: number;
};

/** Trimmt einen String-Wert; leere/Nicht-String-Werte → null. */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Endliche Zahl → gerundeter Integer, sonst null (für width/height). */
function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

/** Endliche, positive Zahl → der Wert selbst, sonst null (für duration_seconds). */
function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * POST /api/portal/orders/[id]/media — legt die **Metadaten** eines bereits
 * direkt in den Storage geladenen Mediums an (zweistufiger Upload).
 *
 * ISOLATION (mehrstufig):
 *  - `business_id` stammt AUSSCHLIESSLICH aus der über RLS geladenen Order
 *    (= Session-Betrieb), NIEMALS aus dem Request-Body.
 *  - Die Order wird über den AUTHENTICATED Server-Client geladen; fremde/fehlende
 *    `order_id` ⇒ 404.
 *  - `storage_path` MUSS mit `${business_id}/${order_id}/` beginnen (zusätzlich
 *    zur Storage-RLS, die das erste Pfad-Segment auf die `business_id` bindet).
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

  // Order über RLS laden — fremde/fehlende id ⇒ 404. business_id kommt von hier.
  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id")
    .eq("id", orderId)
    .maybeSingle<{ id: string; business_id: string }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const businessId = order.business_id;

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    console.error(`[media POST] invalid_body (order ${orderId}):`, err);
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  // media_type — 'photo' (4b) oder 'video' (4c).
  if (payload.media_type !== "photo" && payload.media_type !== "video") {
    console.error(
      `[media POST] invalid_media_type (order ${orderId}):`,
      payload.media_type,
    );
    return NextResponse.json({ error: "invalid_media_type" }, { status: 400 });
  }
  const mediaType = payload.media_type;

  // duration_seconds — bei 'video' erforderlich, bei 'photo' ignoriert (null).
  const durationSeconds =
    mediaType === "video" ? positiveNumberOrNull(payload.duration_seconds) : null;
  if (mediaType === "video" && durationSeconds === null) {
    console.error(
      `[media POST] invalid_duration (order ${orderId}):`,
      payload.duration_seconds,
    );
    return NextResponse.json({ error: "invalid_duration" }, { status: 400 });
  }

  // storage_path MUSS im mandanten- UND auftragsskopierten Pfad liegen.
  const storagePath =
    typeof payload.storage_path === "string" ? payload.storage_path : "";
  const requiredPrefix = `${businessId}/${order.id}/`;
  if (!storagePath.startsWith(requiredPrefix)) {
    console.error(
      `[media POST] invalid_path (order ${orderId}): got "${storagePath}", expected prefix "${requiredPrefix}"`,
    );
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  // sort_order = coalesce(max(sort_order), 0) + 1 für diese Order.
  const { data: last } = await supabase
    .from("order_media")
    .select("sort_order")
    .eq("order_id", order.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const nextSortOrder = (last?.sort_order ?? 0) + 1;

  // `tag` (order_media.tag) wird seit 6b.2 NICHT mehr gesetzt (bleibt null) — die
  // Spalte bleibt für ein späteres Vorher/Nachher-Format erhalten (UI entfernt).
  const { data, error } = await supabase
    .from("order_media")
    .insert({
      order_id: order.id,
      business_id: businessId,
      media_type: mediaType,
      storage_path: storagePath,
      keyword: trimmedOrNull(payload.keyword),
      width: intOrNull(payload.width),
      height: intOrNull(payload.height),
      duration_seconds: durationSeconds,
      sort_order: nextSortOrder,
    })
    .select("id, media_type, storage_path, keyword, sort_order")
    .single<InsertedMedia>();

  if (error || !data) {
    console.error(
      `[media POST] insert_failed (order ${orderId}, path ${storagePath}):`,
      error,
    );
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
