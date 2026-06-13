import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import type { MediaCategory } from "@/lib/orders/queries";

/** Felder, die für den Kategorie-Wechsel eines Mediums benötigt werden. */
type MediaRow = {
  id: string;
  media_type: "photo" | "video";
};

/** Body-Wert als gültige Kategorie (0010) erkennen, sonst null. */
function parseCategory(value: unknown): MediaCategory | null {
  return value === "before" || value === "after" || value === "process"
    ? value
    : null;
}

/**
 * PATCH /api/portal/orders/[id]/media/[mediaId]/category — wechselt die Bild-
 * Kategorie eines Mediums nachträglich (0010): before/after/process.
 *
 * Guards:
 *  - AUTHENTICATED Server-Client (kein `service_role`); kein User ⇒ 401, kein
 *    Betrieb ⇒ 403.
 *  - Medien-Zeile über RLS geladen, gegen `order_id` (Pfad) geprüft ⇒ sonst 404.
 *  - Body `{ category }` muss before/after/process sein ⇒ sonst 400.
 *  - VIDEO darf nur `process` sein (kein Vorher/Nachher) ⇒ sonst 400.
 *  - before/after je max 1 pro Auftrag: belegt ein ANDERES Medium den Slot ⇒ 400
 *    `category_taken`. HARTER Riegel (Client-Disable ist nur UX).
 *
 * Gibt `{ id, category }` zurück.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id: orderId, mediaId } = await params;

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

  // Medien-Zeile über RLS laden; muss zu DIESER Order gehören — sonst 404.
  const { data: media } = await supabase
    .from("order_media")
    .select("id, media_type")
    .eq("id", mediaId)
    .eq("order_id", orderId)
    .maybeSingle<MediaRow>();
  if (!media) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const category = parseCategory((body as { category?: unknown })?.category);
  if (!category) {
    return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  }

  // Video bleibt immer 'process' — kein Vorher/Nachher für Videos.
  if (media.media_type === "video" && category !== "process") {
    return NextResponse.json({ error: "video_process_only" }, { status: 400 });
  }

  // before/after je max 1: belegt ein ANDERES Medium den Slot ⇒ ablehnen.
  if (category === "before" || category === "after") {
    const { count } = await supabase
      .from("order_media")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("category", category)
      .neq("id", media.id);
    if ((count ?? 0) >= 1) {
      return NextResponse.json({ error: "category_taken" }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from("order_media")
    .update({ category })
    .eq("id", media.id)
    .eq("order_id", orderId);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ id: media.id, category }, { status: 200 });
}
