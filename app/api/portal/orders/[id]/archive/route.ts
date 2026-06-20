import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { isArchivable } from "@/lib/orders/archive";

/**
 * POST /api/portal/orders/[id]/archive — archiviert oder entarchiviert einen Auftrag.
 *
 * Body: `{ archive: boolean }`
 *  - `true`  → `archived_at = now()`, nur wenn der Auftrag archivierbar ist
 *              (sent/viewed/shared ODER picked_up_at IS NOT NULL); sonst 409.
 *  - `false` → `archived_at = null`, KEINE Eligibility-Prüfung.
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). 401/403 ohne
 * User/Betrieb. Order über RLS geladen — fremde/fehlende id ⇒ 404. Update
 * defensiv auf `id` + `business_id` gefiltert; `business_id` NIE aus dem Body.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  if (typeof payload.archive !== "boolean") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const doArchive = payload.archive;

  // Order über RLS laden — fremde/fehlende id ⇒ 404. business_id kommt von hier.
  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id, status, picked_up_at, archived_at")
    .eq("id", orderId)
    .maybeSingle<{
      id: string;
      business_id: string;
      status: string;
      picked_up_at: string | null;
      archived_at: string | null;
    }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (doArchive && !isArchivable(order.status, order.picked_up_at)) {
    return NextResponse.json({ error: "not_archivable" }, { status: 409 });
  }

  const { error } = await supabase
    .from("orders")
    .update({ archived_at: doArchive ? new Date().toISOString() : null })
    .eq("id", order.id)
    .eq("business_id", order.business_id);

  if (error) {
    console.error(`[order archive] update_failed (order ${orderId}):`, error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
