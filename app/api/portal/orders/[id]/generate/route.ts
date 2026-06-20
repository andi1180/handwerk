import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { isAiConfigured } from "@/lib/ai/anthropic";
import { generateIntro, IntroParseError } from "@/lib/ai/intro";
import { generateReviewDraft } from "@/lib/ai/review";
import { buildIgCaption } from "@/lib/booklet/ig-caption";
import { generateAccessToken } from "@/lib/booklet/token";
import { generateShortCode } from "@/lib/booklet/short-code";
import { orderBookletMedia } from "@/lib/booklet/media-order";
import { renderReel, type MediaItem } from "@/lib/reel/render";

/**
 * Node-Runtime erzwingen + maxDuration anheben (Fluid Compute): die teure Arbeit
 * (Sonnet-Intro/Review + ffmpeg-Reel) läuft in `after()` NACH der Response —
 * ohne diese Werte würde Vercel den Hintergrund-Job am Default-Timeout killen.
 * Identisch zu render-reel/route.ts.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

/** Echte Fehlermeldung für die Server-Logs (Vercel) extrahieren. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Externer Link ohne Protokoll/Trailing-Slash (Anzeige-Form fürs Reel-Outro). */
function displayHost(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** Wie oft ein neuer short_code bei (sehr seltener) UNIQUE-Kollision versucht wird. */
const SHORT_CODE_MAX_ATTEMPTS = 5;

/**
 * POST /api/portal/orders/[id]/generate — erstellt das Booklet eines Auftrags.
 *
 * B1 — SOFORT-202 + Hintergrund-Arbeit (after()):
 * Der Klick auf „Booklet erstellen" gibt in Millisekunden ein 202 zurück. Synchron
 * (im Request, vor dem 202) laufen NUR die billigen Guards + DB-Writes:
 *   1) Guards (fail fast): Auth-User (401), Auth-Betrieb (403), Order (404), Status
 *      `draft`||`generated` (409), ≥ 1 process-Medium (400 need_process, 0010),
 *      isAiConfigured (500).
 *   2) Booklet-Shell schreiben (Insert/Update) mit LEEREM Inhalt
 *      (intro/review/ig = null), reel_status='rendering', reel_url=null,
 *      access_token/short_code/language/web_story_ready. Token bei Re-Generate behalten.
 *   3) Order-Status → `generated` (defensiv `.eq("status", order.status)`).
 * Schlägt ein Shell-/Status-Write fehl ⇒ 500 (synchron, VOR dem 202) — der Client
 * sieht einen echten Fehler statt einer falschen „läuft im Hintergrund"-Meldung.
 *
 * Die TEURE Arbeit folgt in `after()` (server-seitig nach der Response, innerhalb
 * maxDuration), damit der Nutzer die Seite sofort verlassen kann und alles zu Ende
 * läuft: KI-Intro (Sonnet) → Review (Sonnet, non-fatal) → IG-Caption (Template) →
 * Inhalt persistieren → Reel rendern (renderReel). Fehler im Hintergrund landen in
 * `booklets.reel_status='failed'` (+ reel_error) — der Client erfährt sie über den
 * Reel-Status-Poll. Bei Intro-Fehler wird KEIN Reel gerendert (reel_error 'intro:').
 *
 * Flow-Vereinfachung: KEIN separater `finalized`-Zwischenschritt — der eine Klick
 * führt direkt `draft → generated` aus.
 *
 * ISOLATION (§14.2): Alle service_role-Writes (booklets + Reel) stammen aus der
 * GELADENEN ORDER (über RLS gegen die Session validiert), NIE aus dem Body; jeder
 * Zugriff ist strikt auf diese `business_id` gescoped. In `after()` (nach der
 * Response) laufen Reads/Writes über `service_role` — der request-gebundene
 * AUTHENTICATED Client wäre dort unzuverlässig.
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

  // Erstellen aus `draft` (Normalfall) ODER Re-Generate aus `generated`
  // (solange das Booklet noch nicht versendet wurde). `finalized` existiert nicht mehr.
  if (order.status !== "draft" && order.status !== "generated") {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  // Defensiv: ohne PROZESS-Medium gibt es nichts zu generieren (0010). Ein
  // Auftrag mit nur before/after ist kein Booklet. Videos sind immer `process`.
  const { count } = await supabase
    .from("order_media")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id)
    .eq("category", "process");
  if (!count || count < 1) {
    return NextResponse.json({ error: "need_process" }, { status: 400 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 500 });
  }

  // ───────────────────────── Synchron: billige Writes (vor 202) ───────────────────────

  // booklets-Shell über service_role (0001-RLS), strikt auf die Order-business_id
  // gescoped. Bestehenden access_token BEI Re-Generate behalten — geteilte Links
  // dürfen nicht brechen. Der INHALT (intro/review/ig) bleibt hier LEER und wird
  // erst in after() erzeugt; reel_status='rendering' signalisiert sofort, dass der
  // Hintergrund-Job läuft (das UI nimmt den Poll auf).
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

  let bookletId: string;
  if (existing) {
    // Re-Generate (nur über „Bearbeiten" → erneut „Booklet erstellen" erreichbar):
    // Inhalt auf null zurücksetzen, reel_status='rendering' + reel_url=null (das auf
    // dem alten Booklet-Stand basierende Reel ist veraltet und wird neu gerendert).
    // Token NICHT anfassen.
    const { error: updateError } = await service
      .from("booklets")
      .update({
        intro_title: null,
        intro_description: null,
        review_draft: null,
        ig_caption: null,
        language: order.language,
        web_story_ready: true,
        reel_status: "rendering",
        reel_url: null,
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
    bookletId = existing.id;
  } else {
    // Neues Booklet: leere Inhalts-Shell, web_story_ready=true (renderbar, 8a-2),
    // reel_status='rendering'. short_code (Block C) kollisions-sicher: ein 23505
    // hier betrifft den short_code (order_id-Kollision ist oben ausgeschlossen,
    // access_token-Kollision bei 24 Byte praktisch unmöglich) → neuer Code + Retry.
    const bookletRow = {
      order_id: order.id,
      business_id: order.business_id,
      access_token: token,
      intro_title: null,
      intro_description: null,
      review_draft: null,
      ig_caption: null,
      language: order.language,
      web_story_ready: true,
      reel_status: "rendering",
      reel_url: null,
    };

    let insertedId: string | null = null;
    let lastMessage = "unknown";
    for (let attempt = 0; attempt < SHORT_CODE_MAX_ATTEMPTS; attempt++) {
      const { data: inserted, error } = await service
        .from("booklets")
        .insert({ ...bookletRow, short_code: generateShortCode() })
        .select("id")
        .maybeSingle<{ id: string }>();
      if (!error && inserted) {
        insertedId = inserted.id;
        break;
      }
      lastMessage = error?.message ?? "no row";
      const shortCodeCollision =
        error?.code === "23505" &&
        `${error.message} ${error.details ?? ""}`.includes("short_code");
      if (!shortCodeCollision) break; // anderer Fehler → nicht weiter versuchen
    }
    if (!insertedId) {
      console.error("generate: booklet insert failed", {
        order_id: order.id,
        step: "booklet_insert",
        message: lastMessage,
      });
      return NextResponse.json({ error: "upsert_failed" }, { status: 500 });
    }
    bookletId = insertedId;
  }

  // Order-Status → generated, defensiv auf den GELADENEN Ausgangsstatus gefiltert
  // (kein Doppelübergang bei Races). draft → generated bzw. generated → generated
  // (No-op-Treffer beim Re-Generate). Scheitert dies, bleibt der Auftrag in seinem
  // bisherigen Status — und der Nutzer sieht einen echten Fehler (kein 202).
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

  // ───────────────────── Hintergrund: teure Arbeit nach der Response ──────────────────
  // Reads/Writes über service_role (request-unabhängig, strikt auf order/business
  // gescoped). Fehler ⇒ reel_status='failed' (+ reel_error), nie hängendes 'rendering'.
  after(async () => {
    /** Reel-Render bei einem Fehler in after() als 'failed' markieren (Diagnose). */
    const failReel = async (label: string, message: string): Promise<void> => {
      await service
        .from("booklets")
        .update({ reel_status: "failed", reel_error: `${label}: ${message}` })
        .eq("order_id", order.id)
        .eq("business_id", order.business_id);
    };

    try {
      // a) Captions als Kontext fürs Intro (caption IS NOT NULL, in sort_order).
      const { data: captionRows } = await service
        .from("order_media")
        .select("caption")
        .eq("order_id", order.id)
        .not("caption", "is", null)
        .order("sort_order", { ascending: true })
        .returns<{ caption: string | null }[]>();
      const captions = (captionRows ?? [])
        .map((m) => m.caption?.trim())
        .filter((c): c is string => Boolean(c));

      // b) KI-Intro (Sonnet). Fehler (IntroParseError ODER sonstiger) ⇒
      //    reel_status='failed' (reel_error 'intro: …') + Abbruch — KEIN Reel ohne Intro.
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
        const message = errMessage(error);
        console.error("generate: intro generation failed", {
          order_id: order.id,
          step: isParse ? "intro_parse" : "intro_sonnet",
          message,
        });
        await failReel("intro", message);
        return;
      }

      // c) Google-Review-Entwurf (Sonnet, §8.6) — NON-FATAL: ein Fehler hier darf
      //    die Generierung NICHT blockieren (die Web-Story funktioniert ohne den
      //    Vorschlag). Erfolg ⇒ review_draft, sonst null (+ Log).
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
        // reviewDraft bleibt null — Booklet wird trotzdem fertiggestellt.
      }

      // d) IG-Caption (reines Template, KEIN KI-Call → kann nicht fehlschlagen).
      const igCaption = buildIgCaption({
        introTitle: intro.title,
        igHandle: business.settings.ig_handle,
      });

      // e) Inhalt persistieren (service_role, order_id + business_id). Scheitert der
      //    Persist ⇒ failed + Abbruch — kein Reel auf nicht-gespeichertem Inhalt
      //    (sonst: Reel fertig, aber Web-Story mit leerem Intro).
      const { error: contentError } = await service
        .from("booklets")
        .update({
          intro_title: intro.title,
          intro_description: intro.description,
          review_draft: reviewDraft,
          ig_caption: igCaption,
        })
        .eq("order_id", order.id)
        .eq("business_id", order.business_id);
      if (contentError) {
        console.error("generate: booklet content update failed", {
          order_id: order.id,
          step: "booklet_content",
          message: contentError.message,
        });
        await failReel("save", contentError.message);
        return;
      }

      // f) Reel rendern (gleiche Argument-Form wie render-reel/route.ts in after()).
      //    Medien in Booklet-Ordnung laden: before → process (sort_order) → after
      //    (0010), inkl. caption/keyword/category für die Overlays. renderReel setzt
      //    reel_status selbst auf 'ready'/'failed' (+ reel_error) — KEIN finaler
      //    Status-Write hier.
      const { data: mediaRows } = await service
        .from("order_media")
        .select("storage_path, media_type, caption, keyword, category")
        .eq("order_id", order.id)
        .order("sort_order", { ascending: true })
        .returns<MediaItem[]>();
      const media = orderBookletMedia(mediaRows ?? []);

      // Outro-Kontaktzeilen (nur Telefon/Website, soweit gesetzt) — KEINE Share-/
      // Review-Elemente (Step 9). E-Mail/IG/Review bleiben der Web-Story.
      const contactLines: string[] = [];
      if (business.settings.contact_phone) {
        contactLines.push(business.settings.contact_phone);
      }
      if (business.settings.website_url) {
        contactLines.push(displayHost(business.settings.website_url));
      }

      await renderReel({
        orderId: order.id,
        businessId: order.business_id,
        bookletId,
        media,
        // Intro: KI-Titel (Fallback Betriebsname, wie die Web-Story) + die
        // persönliche Ich-Beschreibung (FIX 8b-1c) + Tagline.
        introTitle: intro.title.trim() || business.name,
        introDescription: intro.description.trim() || null,
        introTagline: business.settings.intro_tagline,
        // Outro: Betriebsname + Nachricht + Kontakt.
        businessName: business.name,
        outroMessage: business.settings.outro_message,
        contactLines,
        // Branding: Farben (Verlauf-Fallback + Akzente) und Storage-Pfade der Bilder.
        primaryColor: business.branding.primary_color,
        secondaryColor: business.branding.secondary_color,
        logoPerPage: business.branding.logo_per_page,
        logoPath: business.branding.logo_url,
        introBgPath: business.branding.intro_bg_url,
        outroBgPath: business.branding.outro_bg_url,
      });
    } catch (error) {
      // Sicherheitsnetz: ein unerwarteter Fehler darf reel_status nicht für immer
      // auf 'rendering' hängen lassen.
      console.error("generate: after() unexpected error", {
        order_id: order.id,
        message: errMessage(error),
      });
      try {
        await failReel("after", errMessage(error));
      } catch {
        // ignorieren — DB nicht erreichbar; nichts mehr zu tun.
      }
    }
  });

  return NextResponse.json(
    { ok: true, token, status: "rendering" },
    { status: 202 },
  );
}
