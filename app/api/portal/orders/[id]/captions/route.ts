import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { isAiConfigured } from "@/lib/ai/anthropic";
import { captionForMedia } from "@/lib/ai/media-caption";
import type { MediaCategory } from "@/lib/orders/queries";

/** Wie viele Captions gleichzeitig generiert werden (begrenzte Nebenläufigkeit). */
const CONCURRENCY = 3;

/** Ein noch nicht beschriftetes Medium dieses Auftrags. */
type PendingMedia = {
  id: string;
  media_type: "photo" | "video";
  storage_path: string;
  keyword: string | null;
  category: MediaCategory;
};

/** Ein erfolgreich gespeichertes Caption-Ergebnis. */
type CaptionResult = { id: string; caption: string };

/**
 * Führt async-Tasks mit begrenzter Nebenläufigkeit aus (max. `limit` parallel).
 * Reihenfolge der Ergebnisse entspricht der Eingabe.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue; // unter noUncheckedIndexedAccess
      results[index] = await fn(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/** Liest ein optionales `ids`-Array (String-Liste) aus dem Request-Body. */
async function readSelectedIds(request: Request): Promise<string[] | null> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === "object" && "ids" in body) {
      const raw = (body as { ids?: unknown }).ids;
      if (Array.isArray(raw) && raw.every((v) => typeof v === "string")) {
        return raw as string[];
      }
    }
  } catch {
    // Kein/ungültiger Body → wie „keine Auswahl" behandeln (alle ohne Caption).
  }
  return null;
}

/**
 * POST /api/portal/orders/[id]/captions — Batch-Generierung von KI-Captions
 * (Schritt 6b). Beschriftet Medien des Auftrags OHNE Caption; manuell gesetzte
 * Captions (caption ≠ null) bleiben unberührt.
 *
 * Optionaler Body `{ ids?: string[] }` (6b.2): ist eine nicht-leere Auswahl
 * gesetzt, werden **nur** diese (und nur unbeschriftete) generiert; fehlt/leer ⇒
 * alle ohne Caption (bisheriges Verhalten). Die `ids` werden durch
 * `.eq("order_id", …)` (RLS-skopiert) gegen Order/Betrieb validiert — fremde ids
 * matchen schlicht nicht.
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). `getCurrentBusiness`
 * (Session) → kein User/Betrieb ⇒ 401/403. Die Order wird über RLS geladen
 * (fremde/fehlende id ⇒ 404); Medien werden über RLS geladen und das Bild
 * server-seitig (Storage-Download → base64) an Haiku gegeben. Jedes Update ist
 * defensiv auf `order_id` gefiltert. Gibt die aktualisierten `{ id, caption }` zurück.
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

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 500 });
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

  const selectedIds = await readSelectedIds(request);

  // Nur Medien OHNE Caption (caption IS NULL) — manuelle Edits nicht überschreiben.
  // Bei gesetzter Auswahl zusätzlich auf diese ids beschränken (order-skopiert).
  let query = supabase
    .from("order_media")
    .select("id, media_type, storage_path, keyword, category")
    .eq("order_id", order.id)
    .is("caption", null);
  if (selectedIds && selectedIds.length > 0) {
    query = query.in("id", selectedIds);
  }
  const { data: pending } = await query
    .order("sort_order", { ascending: true })
    .returns<PendingMedia[]>();
  const rows = pending ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ updated: [] }, { status: 200 });
  }

  const outcomes = await mapWithConcurrency<PendingMedia, CaptionResult | null>(
    rows,
    CONCURRENCY,
    async (media) => {
      try {
        const caption = await captionForMedia(supabase, media);
        // Leere Caption (z. B. Video ohne Stichwort) nicht speichern → bleibt offen.
        if (!caption) return null;
        const { error } = await supabase
          .from("order_media")
          .update({ caption })
          .eq("id", media.id)
          .eq("order_id", order.id);
        if (error) return null;
        return { id: media.id, caption };
      } catch {
        return null;
      }
    },
  );

  const updated = outcomes.filter((o): o is CaptionResult => o !== null);
  return NextResponse.json({ updated }, { status: 200 });
}
