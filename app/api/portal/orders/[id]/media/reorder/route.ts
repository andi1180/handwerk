import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/**
 * PATCH /api/portal/orders/[id]/media/reorder — speichert die neue Reihenfolge
 * der Medien eines Auftrags (mobiler Assembler 6a).
 *
 * Body: `{ ids: string[] }` — die Medien-Ids in der gewünschten Reihenfolge.
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). `getCurrentBusiness`
 * (Session) → kein User/Betrieb ⇒ 401/403. Die Order wird über RLS geladen
 * (fremde/fehlende id ⇒ 404). Es wird verlangt, dass die übergebenen Ids **exakt**
 * der Medien-Menge dieser Order entsprechen (keine fremden, keine doppelten, keine
 * fehlenden) — sonst 400. `sort_order` wird auf 1..n gesetzt; jedes Update ist
 * zusätzlich defensiv auf `order_id` gefiltert. `order_media`-RLS greift ohnehin.
 */
export async function PATCH(
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

  // Order über RLS laden — fremde/fehlende id ⇒ 404.
  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .maybeSingle<{ id: string }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  const ids = payload.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id): id is string => typeof id === "string")
  ) {
    return NextResponse.json({ error: "invalid_ids" }, { status: 400 });
  }
  // Keine Duplikate.
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "invalid_ids" }, { status: 400 });
  }

  // Alle existierenden Medien-Ids dieser Order (RLS) — muss exakt mit `ids` decken.
  const { data: existing } = await supabase
    .from("order_media")
    .select("id")
    .eq("order_id", order.id)
    .returns<{ id: string }[]>();
  const existingIds = new Set((existing ?? []).map((m) => m.id));
  if (ids.length !== existingIds.size || !ids.every((id) => existingIds.has(id))) {
    return NextResponse.json({ error: "ids_mismatch" }, { status: 400 });
  }

  // sort_order = Position+1; jedes Update zusätzlich auf order_id gefiltert.
  const results = await Promise.all(
    ids.map((id, index) =>
      supabase
        .from("order_media")
        .update({ sort_order: index + 1 })
        .eq("id", id)
        .eq("order_id", order.id),
    ),
  );
  if (results.some((r) => r.error)) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
