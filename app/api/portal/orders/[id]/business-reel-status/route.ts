import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { isStaleRendering, staleCutoff } from "@/lib/reel/stale";

/**
 * Schritt 2b — Betriebs-Reel-Status-Poll (0013).
 *
 * Gibt `{ status, url? }` zurück. `url` ist eine frisch signierte Signed-URL
 * (3600 s) auf das fertige Betriebs-Reel — **nur** wenn status === 'ready'.
 *
 * AUTHENTICATED + RLS: der AUTHENTICATED Client sieht nur Booklets des eigenen
 * Betriebs; `business_reel_url` wird über die 0002-Policy signiert (KEIN
 * service_role beim Signieren — identisch zu reel-status).
 *
 * SELBSTHEILUNG: Hängt die Zeile länger als `STALE_RENDER_MS` auf
 * `'rendering'` (Instanz per OOM/Timeout hart beendet, `after()` konnte kein
 * `'failed'` mehr schreiben), setzt dieser Poll sie auf `'failed'` — bedingt
 * auf `status='rendering' AND updated_at < cutoff`, damit ein parallel fertig
 * gewordener Render nicht überschrieben wird. Danach wird der TATSÄCHLICHE
 * Stand zurückgegeben. AUTHENTICATED Client (RLS, `booklets_update`), kein
 * service_role.
 */
export const runtime = "nodejs";

const SIGNED_URL_TTL_SECONDS = 3600;

type BookletRow = {
  id: string;
  business_reel_status: string;
  business_reel_url: string | null;
  updated_at: string | null;
};

const BOOKLET_COLUMNS = "id, business_reel_status, business_reel_url, updated_at";

export async function GET(
  _request: Request,
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

  // Order via RLS (fremde/fehlende id ⇒ 404).
  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id")
    .eq("id", orderId)
    .maybeSingle<{ id: string; business_id: string }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Booklet via RLS (business_id-gescoped, member-lesbar).
  const { data: loaded } = await supabase
    .from("booklets")
    .select(BOOKLET_COLUMNS)
    .eq("order_id", order.id)
    .eq("business_id", order.business_id)
    .maybeSingle<BookletRow>();
  let booklet = loaded;
  if (!booklet) {
    return NextResponse.json(
      { status: "pending", url: null },
    );
  }

  // Selbstheilung: hängendes 'rendering' ⇒ 'failed' (bedingt, s. Doc oben).
  const now = new Date();
  if (
    isStaleRendering(booklet.business_reel_status, booklet.updated_at, now)
  ) {
    const { data: healed, error: healError } = await supabase
      .from("booklets")
      .update({
        business_reel_status: "failed",
        business_reel_error: t(DEFAULT_LOCALE, "businessReel.staleError"),
      })
      .eq("id", booklet.id)
      .eq("business_id", order.business_id)
      .eq("business_reel_status", "rendering")
      .lt("updated_at", staleCutoff(now).toISOString())
      .select(BOOKLET_COLUMNS)
      .maybeSingle<BookletRow>();

    if (healError) {
      console.error("business-reel-status: self-heal failed", {
        order_id: order.id,
        step: "self_heal",
        message: healError.message,
      });
    }

    if (healed) {
      console.warn("business-reel-status: stale render marked failed", {
        order_id: order.id,
        updated_at: booklet.updated_at,
      });
      booklet = healed;
    } else {
      // 0 Zeilen getroffen (parallel fertig/neu gestartet) oder Fehler ⇒
      // tatsächlichen Stand neu lesen statt den alten zu melden.
      const { data: fresh } = await supabase
        .from("booklets")
        .select(BOOKLET_COLUMNS)
        .eq("id", booklet.id)
        .eq("business_id", order.business_id)
        .maybeSingle<BookletRow>();
      if (fresh) booklet = fresh;
    }
  }

  // Signed-URL nur bei 'ready'.
  let url: string | null = null;
  if (booklet.business_reel_status === "ready" && booklet.business_reel_url) {
    const { data: signed } = await supabase.storage
      .from("order-media")
      .createSignedUrl(booklet.business_reel_url, SIGNED_URL_TTL_SECONDS);
    url = signed?.signedUrl ?? null;
  }

  return NextResponse.json({
    status: booklet.business_reel_status,
    url,
  });
}
