import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/** Erlaubte Medien-Tags (Spiegel der DB-Check-Constraint auf `order_media.tag`). */
const ALLOWED_TAGS = ["vorher", "nachher", "prozess"] as const;
type AllowedTag = (typeof ALLOWED_TAGS)[number];

/** Die zurückgegebene (und für die Liste relevante) Medien-Zeile. */
type InsertedMedia = {
  id: string;
  media_type: "photo" | "video";
  storage_path: string;
  keyword: string | null;
  tag: AllowedTag | null;
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
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  // media_type — in 4b ausschließlich 'photo' (Video folgt in 4c).
  if (payload.media_type !== "photo") {
    return NextResponse.json({ error: "invalid_media_type" }, { status: 400 });
  }

  // storage_path MUSS im mandanten- UND auftragsskopierten Pfad liegen.
  const storagePath =
    typeof payload.storage_path === "string" ? payload.storage_path : "";
  const requiredPrefix = `${businessId}/${order.id}/`;
  if (!storagePath.startsWith(requiredPrefix)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  // tag optional; falls gesetzt, muss er gültig sein.
  const rawTag = trimmedOrNull(payload.tag);
  if (rawTag !== null && !ALLOWED_TAGS.includes(rawTag as AllowedTag)) {
    return NextResponse.json({ error: "invalid_tag" }, { status: 400 });
  }
  const tag = rawTag as AllowedTag | null;

  // sort_order = coalesce(max(sort_order), 0) + 1 für diese Order.
  const { data: last } = await supabase
    .from("order_media")
    .select("sort_order")
    .eq("order_id", order.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();
  const nextSortOrder = (last?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("order_media")
    .insert({
      order_id: order.id,
      business_id: businessId,
      media_type: "photo",
      storage_path: storagePath,
      keyword: trimmedOrNull(payload.keyword),
      tag,
      width: intOrNull(payload.width),
      height: intOrNull(payload.height),
      sort_order: nextSortOrder,
    })
    .select("id, media_type, storage_path, keyword, tag, sort_order")
    .single<InsertedMedia>();

  if (error || !data) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
