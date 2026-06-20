import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { orderBookletMedia } from "@/lib/booklet/media-order";
import { renderReel, type MediaItem } from "@/lib/reel/render";

/**
 * SCHRITT 8b-2b — Captions + Logo-Wasserzeichen auf den Video-Clips.
 *
 * Baut aus einem generierten Booklet ein 9:16-Reel (1080x1920, HARTE Schnitte,
 * KEIN Audio): Intro-Frame (~4 s) → die MEDIEN in sort_order (Foto-Stills je 3 s
 * UND normalisierte Video-Clips, gemischt) → Outro-Frame (~2,5 s). Der Render
 * läuft in `after()` (Hintergrund nach der Response, innerhalb maxDuration); der
 * Fortschritt ist über `booklets.reel_status` persistent (Poll + Reload).
 *
 *  - Intro:  intro_bg (Bild) oder Verlauf, Logo prominent oben, KI-Titel +
 *            persönliche Ich-Beschreibung + Tagline.
 *  - Fotos:  cover-crop + Caption-Overlay (8b-1b); ZUSÄTZLICH bei logo_per_page ein
 *            dezentes Logo-Wasserzeichen (8b-1c). UNVERÄNDERT.
 *  - Clips:  auf die KANONISCHE Form normalisiert (cover 9:16, 30 fps, yuv420p,
 *            STUMM, auf 6 s gecappt) — IDENTISCH zu den Foto-Segmenten, sonst bricht
 *            der concat-Demuxer; jetzt mit DERSELBEN Overlay-Kette wie die Fotos
 *            (Caption + optionales Wasserzeichen) über den Video-Stream (8b-2b).
 *  - Outro:  outro_bg/Verlauf, Logo, Betriebsname + Nachricht + Kontakt
 *            (Telefon/Website). KEINE Share-/Review-Elemente (Step 9).
 *
 * ASSEMBLY (8b-2a): jedes Item wird zu einem formatgleichen mp4-Zwischensegment
 * gerendert; die Segmente werden per concat-Demuxer (-c copy) in EINER Reihenfolge
 * (Intro → Items → Outro) gefügt — robustes Interleaving heterogener Medien.
 *
 * Die gesamte ffmpeg-Filtergraph-/Encode-Logik liegt in `lib/reel/frames.ts` —
 * diese Route ist reine Orchestrierung (Auth/Status/Downloads/Upload). NUR FFmpeg,
 * KEIN Sharp. Schrift + Scrims sind MITGELIEFERT und EXPLIZIT per Pfad referenziert
 * (kein fontconfig — der ist auf Vercel leer).
 *
 * KEIN Ken-Burns (8b-3).
 *
 * Node-Runtime erzwingen (Edge kann kein child_process / Binary ausführen) und
 * maxDuration anheben (Fluid Compute) — Download + ffmpeg + Upload dürfen dauern.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

/** Status, in denen ein Reel renderbar ist (Booklet existiert) — FIX 7.1: auch
 *  nach dem Versand, damit ein vor dem Render ausgelieferter Auftrag keine
 *  Sackgasse ist. Der Order-Status wird vom Render NICHT verändert. */
const RENDERABLE_STATUSES = ["generated", "sent", "viewed", "shared"];

type OrderRow = { id: string; business_id: string; status: string };
type BookletRow = {
  id: string;
  intro_title: string | null;
  intro_description: string | null;
};

/** Externer Link ohne Protokoll/Trailing-Slash (Anzeige-Form fürs Outro). */
function displayHost(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/**
 * POST /api/portal/orders/[id]/render-reel
 *
 * Guards (alle vor dem Schreiben):
 *  - AUTHENTICATED Server-Client; kein User ⇒ 401, kein Betrieb ⇒ 403.
 *  - Order über RLS geladen (fremde/fehlende id ⇒ 404).
 *  - Status muss `generated` sein ⇒ sonst 409.
 *  - Mindestens ein Medium (Foto ODER Video, `order_media`) ⇒ sonst 400 need_media.
 *
 * ISOLATION (§14.2): Die `business_id` stammt AUS DER GELADENEN ORDER (über RLS
 * gegen die Session validiert), NIE aus dem Body. Alle Storage-/booklets-Writes
 * laufen über `service_role`, strikt auf diese `business_id` gescoped; der Pfad
 * `{business_id}/{order_id}/reel.mp4` deckt die bestehende 0002-Policy ab.
 *
 * Antwort: 202 (rendering gestartet). Die eigentliche Arbeit folgt in after().
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
    .select("id, business_id, status")
    .eq("id", orderId)
    .maybeSingle<OrderRow>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Reel ist ab der Generierung renderbar — AUCH nach dem Versand (FIX 7.1,
  // REVIEW): liefert ein Betrieb VOR dem Reel-Render aus (Status → sent, nicht
  // mehr reopenbar), bliebe das Reel sonst dauerhaft un-renderbar (Sackgasse).
  // Erlaubt sind alle Stufen, in denen ein Booklet existiert: generated, sent,
  // viewed, shared. WICHTIG: Dieser Render erzeugt NUR das Reel-Artefakt
  // (booklets.reel_* + Storage) und lässt den Order-STATUS UNBERÜHRT — kein
  // Zurücksetzen auf `generated`, kein Nachversand, keine erneute E-Mail. Das
  // Reel erscheint im bestehenden Booklet unter demselben Link.
  if (!RENDERABLE_STATUSES.includes(order.status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 409 });
  }

  // ALLE Medien laden (RLS): Fotos UND Video-Clips, sort_order ASC; danach in die
  // feste Booklet-Reihenfolge bringen (0010): before → process (sort_order) →
  // after. caption/keyword für die Overlays auf Fotos UND Clips (8b-1b/8b-2b).
  // Ohne jedes Medium kein Reel.
  const { data: mediaRows } = await supabase
    .from("order_media")
    .select("storage_path, media_type, caption, keyword, category")
    .eq("order_id", order.id)
    .order("sort_order", { ascending: true })
    .returns<MediaItem[]>();
  const media = orderBookletMedia(mediaRows ?? []);
  if (media.length < 1) {
    return NextResponse.json({ error: "need_media" }, { status: 400 });
  }

  // Booklet (existiert, da Status `generated`) über service_role laden — wir
  // setzen darauf den Render-Status und brauchen den KI-Intro-Titel. Strikt auf
  // die Order-business_id gescoped.
  const service = createServiceClient();
  const { data: booklet, error: bookletError } = await service
    .from("booklets")
    .select("id, intro_title, intro_description")
    .eq("order_id", order.id)
    .eq("business_id", order.business_id)
    .maybeSingle<BookletRow>();
  if (bookletError || !booklet) {
    console.error("render-reel: booklet load failed", {
      order_id: order.id,
      step: "booklet_load",
      message: bookletError?.message ?? "no booklet",
    });
    return NextResponse.json({ error: "no_booklet" }, { status: 500 });
  }

  // Sofort auf 'rendering' setzen (reel_error löschen) und 202 zurückgeben.
  const { error: statusError } = await service
    .from("booklets")
    .update({ reel_status: "rendering", reel_error: null })
    .eq("id", booklet.id)
    .eq("business_id", order.business_id);
  if (statusError) {
    console.error("render-reel: set rendering failed", {
      order_id: order.id,
      step: "set_rendering",
      message: statusError.message,
    });
    return NextResponse.json({ error: "status_failed" }, { status: 500 });
  }

  // Outro-Kontaktzeilen aus den Settings (nur Telefon/Website, soweit gesetzt) —
  // KEINE Share-/Review-Elemente (Step 9). E-Mail/IG/Review bleiben der Web-Story.
  const contactLines: string[] = [];
  if (business.settings.contact_phone) contactLines.push(business.settings.contact_phone);
  if (business.settings.website_url) {
    contactLines.push(displayHost(business.settings.website_url));
  }

  // Heavy lifting NACH der Response (innerhalb maxDuration). Fehler landen in
  // reel_status='failed' + reel_error — der Client erfährt sie über den Poll.
  after(() =>
    renderReel({
      orderId: order.id,
      businessId: order.business_id,
      bookletId: booklet.id,
      media,
      // Intro: KI-Titel (Fallback Betriebsname, wie die Web-Story) + die
      // persönliche Ich-Beschreibung (FIX 8b-1c) + Tagline.
      introTitle: booklet.intro_title?.trim() || business.name,
      introDescription: booklet.intro_description?.trim() || null,
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
    }),
  );

  return NextResponse.json({ ok: true, status: "rendering" }, { status: 202 });
}
