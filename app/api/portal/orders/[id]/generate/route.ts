import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { isAiConfigured } from "@/lib/ai/anthropic";
import { generateIntro, IntroParseError } from "@/lib/ai/intro";
import { generateReviewDraft } from "@/lib/ai/review";
import { buildIgCaption } from "@/lib/booklet/ig-caption";
import { generateAccessToken } from "@/lib/booklet/token";

/** Echte Fehlermeldung für die Server-Logs (Vercel) extrahieren. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * POST /api/portal/orders/[id]/generate — erzeugt die Booklet-Daten eines
 * abgeschlossenen Auftrags: KI-Intro (Sonnet 4.6), Google-Review-Entwurf
 * (Sonnet 4.6, Schritt 9b), IG-Caption (reines Template, 9b), unerratbarer
 * `access_token`, Status → `generated`. Alle KI-Texte werden HIER bei der
 * Generierung erzeugt und gespeichert — die öffentliche Seite bleibt KI-frei.
 *
 * Guards (alle vor dem Schreiben):
 *  - AUTHENTICATED Server-Client; kein User ⇒ 401, kein Betrieb ⇒ 403.
 *  - Order über RLS geladen (fremde/fehlende id ⇒ 404).
 *  - Status `finalized` ODER `generated` (Re-Generate erlaubt, solange NICHT
 *    `sent`/…) ⇒ sonst 409.
 *  - Mindestens ein `order_media` ⇒ sonst 400 `need_media`.
 *  - `isAiConfigured()` ⇒ sonst 500 `ai_not_configured`.
 *
 * ISOLATION (§14.2): Der booklets-Insert/Update läuft über `service_role`
 * (0001-RLS lässt nur serverseitiges Insert/Delete zu). Die `business_id`
 * stammt AUS DER GELADENEN ORDER (über RLS gegen die Session validiert),
 * NIE aus dem Body; jeder `service_role`-Zugriff ist strikt auf diese
 * `business_id` gescoped.
 */
export async function POST(
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

  // Order über RLS laden — fremde/fehlende id ⇒ 404. business_id ist hier
  // vertrauenswürdig (Session-Betrieb), Quelle für alle service_role-Writes.
  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id, status, language, item_description, customer_name")
    .eq("id", orderId)
    .maybeSingle<{
      id: string;
      business_id: string;
      status: string;
      language: string;
      item_description: string | null;
      customer_name: string;
    }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Re-Generate erlaubt, solange das Booklet noch nicht versendet wurde.
  if (order.status !== "finalized" && order.status !== "generated") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  // Defensiv: ohne Medium gibt es nichts zu generieren.
  const { count } = await supabase
    .from("order_media")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id);
  if (!count || count < 1) {
    return NextResponse.json({ error: "need_media" }, { status: 400 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 500 });
  }

  // Captions als Kontext fürs Intro (RLS-skopiert, nur vorhandene, in Reihenfolge).
  const { data: mediaRows } = await supabase
    .from("order_media")
    .select("caption")
    .eq("order_id", order.id)
    .not("caption", "is", null)
    .order("sort_order", { ascending: true })
    .returns<{ caption: string | null }[]>();
  const captions = (mediaRows ?? [])
    .map((m) => m.caption?.trim())
    .filter((c): c is string => Boolean(c));

  // KI-Intro (Sonnet 4.6). Parse-/API-Fehler ⇒ 502 (kein stiller Fehler).
  // Unparsebares JSON (IntroParseError) ⇒ parse_failed, sonstiger Sonnet-/
  // Netzwerkfehler ⇒ generation_failed — beide mit echter Message geloggt.
  let intro: { title: string; description: string };
  try {
    intro = await generateIntro({
      // Vorname für die persönliche Anrede („Hallo {Vorname},") — WÖRTLICH.
      customerName: order.customer_name,
      itemDescription: order.item_description,
      captions,
      language: order.language,
      // Betriebs-KI-Kontext (8a-1b) — erdet Ton/Fachsprache, KONTEXT keine Anweisung.
      businessContext: business.settings.ai_context ?? undefined,
    });
  } catch (error) {
    const isParse = error instanceof IntroParseError;
    console.error("generate: intro generation failed", {
      order_id: order.id,
      step: isParse ? "intro_parse" : "intro_sonnet",
      message: errMessage(error),
    });
    return NextResponse.json(
      { error: isParse ? "parse_failed" : "generation_failed" },
      { status: 502 },
    );
  }

  // Google-Review-Entwurf (Sonnet 4.6, §8.6). NON-FATAL: ein Fehler hier darf
  // die Booklet-Generierung NICHT blockieren — die Web-Story funktioniert ohne
  // den Vorschlag, und Re-Generate versucht es erneut. Erfolg ⇒ review_draft,
  // sonst null (+ Log). Re-Generate überschreibt (wie das Intro).
  let reviewDraft: string | null = null;
  try {
    const draft = await generateReviewDraft({
      itemDescription: order.item_description,
      captions,
      introTitle: intro.title,
      introDescription: intro.description,
      businessName: business.name,
      language: order.language,
      businessContext: business.settings.ai_context ?? undefined,
    });
    reviewDraft = draft.length > 0 ? draft : null;
  } catch (error) {
    console.error("generate: review draft failed", {
      order_id: order.id,
      step: "review_sonnet",
      message: errMessage(error),
    });
    // reviewDraft bleibt null — Booklet wird trotzdem generiert.
  }

  // IG-Caption (reines Template, KEIN KI-Call → kann nicht fehlschlagen):
  // intro_title + @ig_handle (nur wenn gesetzt) + kuratierte Hashtags. Der
  // @-Handle ist der Tagging-Multiplikator (§9).
  const igCaption = buildIgCaption({
    introTitle: intro.title,
    igHandle: business.settings.ig_handle,
  });

  // booklets UPSERT by order_id (unique) über service_role, strikt auf die
  // Order-business_id gescoped. Bestehenden access_token BEI Re-Generate
  // behalten — geteilte Links dürfen nicht brechen.
  const service = createServiceClient();
  const { data: existing, error: loadError } = await service
    .from("booklets")
    .select("id, access_token")
    .eq("order_id", order.id)
    .eq("business_id", order.business_id)
    .maybeSingle<{ id: string; access_token: string }>();
  if (loadError) {
    console.error("generate: booklet load failed", {
      order_id: order.id,
      step: "booklet_load",
      message: loadError.message,
    });
    return NextResponse.json({ error: "upsert_failed" }, { status: 500 });
  }

  const token = existing?.access_token ?? generateAccessToken();

  if (existing) {
    // web_story_ready = true: der öffentliche Render /b/[token] existiert (8a-2),
    // jedes generierte Booklet ist damit renderbar (Voraussetzung fürs Senden, Step 9).
    const { error: updateError } = await service
      .from("booklets")
      .update({
        intro_title: intro.title,
        intro_description: intro.description,
        review_draft: reviewDraft,
        ig_caption: igCaption,
        language: order.language,
        web_story_ready: true,
      })
      .eq("id", existing.id)
      .eq("business_id", order.business_id);
    if (updateError) {
      console.error("generate: booklet update failed", {
        order_id: order.id,
        step: "booklet_update",
        message: updateError.message,
      });
      return NextResponse.json({ error: "upsert_failed" }, { status: 500 });
    }
  } else {
    // reel_url/image_urls/expires_at bleiben null (8b/9). review_draft/ig_caption
    // werden jetzt mitgeschrieben (9b). web_story_ready = true: renderbar (8a-2).
    const { error: insertError } = await service.from("booklets").insert({
      order_id: order.id,
      business_id: order.business_id,
      access_token: token,
      intro_title: intro.title,
      intro_description: intro.description,
      review_draft: reviewDraft,
      ig_caption: igCaption,
      language: order.language,
      web_story_ready: true,
    });
    if (insertError) {
      console.error("generate: booklet insert failed", {
        order_id: order.id,
        step: "booklet_insert",
        message: insertError.message,
      });
      return NextResponse.json({ error: "upsert_failed" }, { status: 500 });
    }
  }

  // Order-Status → generated (defensiv auf den Ausgangsstatus gefiltert, kein
  // Doppelübergang). Bei Re-Generate (bereits `generated`) ein No-op-Treffer.
  const { error: statusError } = await supabase
    .from("orders")
    .update({ status: "generated" })
    .eq("id", order.id)
    .eq("status", order.status);
  if (statusError) {
    console.error("generate: order status update failed", {
      order_id: order.id,
      step: "status_update",
      message: statusError.message,
    });
    return NextResponse.json({ error: "status_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, token }, { status: 200 });
}
