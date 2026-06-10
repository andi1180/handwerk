import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { CAPTION_MAX_LENGTH } from "@/lib/ai/caption-limits";

/**
 * PATCH /api/portal/orders/[id]/media/[mediaId]/caption — speichert einen manuell
 * bearbeiteten Caption-Text (Schritt 6b). KEINE KI nötig (reines Update).
 *
 * Body: `{ caption: string }` — leer ⇒ Caption wird auf `null` gesetzt. Länge
 * serverseitig auf `CAPTION_MAX_LENGTH` begrenzt (sonst 400).
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). 401/403 ohne
 * User/Betrieb. Die Medien-Zeile wird über RLS geladen und gegen `order_id`
 * (Pfad) geprüft — fremde/fehlende Kombination ⇒ 404. Das Update ist defensiv
 * auf `order_id` gefiltert.
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
    .select("id")
    .eq("id", mediaId)
    .eq("order_id", orderId)
    .maybeSingle<{ id: string }>();
  if (!media) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  if (typeof payload.caption !== "string") {
    return NextResponse.json({ error: "invalid_caption" }, { status: 400 });
  }
  const trimmed = payload.caption.trim();
  if (trimmed.length > CAPTION_MAX_LENGTH) {
    return NextResponse.json({ error: "caption_too_long" }, { status: 400 });
  }
  const captionValue = trimmed.length > 0 ? trimmed : null;

  const { error } = await supabase
    .from("order_media")
    .update({ caption: captionValue })
    .eq("id", media.id)
    .eq("order_id", orderId);
  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json(
    { id: media.id, caption: captionValue ?? "" },
    { status: 200 },
  );
}
