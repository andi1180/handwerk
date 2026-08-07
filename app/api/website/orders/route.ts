import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/website/orders — LESENDER Feed für die öffentliche Website des
 * Betriebs (Repo atelier-dax-web, Archiv `/verwandlungen`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PULL, NICHT PUSH — Handwerk sendet nichts
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Website ruft alle 15 Minuten hier ab. Es gibt KEINEN ausgehenden Call,
 * KEINEN Webhook, KEINE Benachrichtigung von hier nach dort. Handwerk bleibt
 * von der Anbindung vollständig ZUSTANDSLOS: dieser Endpunkt liest
 * ausschließlich — kein Insert, kein Update, kein Delete, insbesondere KEIN
 * „abgeholt"-Vermerk. Ob ein Stück drüben schon übernommen ist, weiß allein die
 * Website (sie merkt sich die `id` von hier als `handwerk_order_id`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTH = Bearer-Token, NICHT Pfad-Secret (§14.2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `Authorization: Bearer <secret>` → `businesses.website_pull_secret` →
 * `business_id`. Diese `business_id` ist die EINZIGE Vertrauensquelle und wird
 * jeder Query als Filter mitgegeben — sie kommt NIE aus der Anfrage.
 *
 * ⚠️ Warum Kopfzeile und nicht Pfad, anders als beim eingehenden Webhook
 *    ([app/api/webhook/[secret]/route.ts](app/api/webhook/[secret]/route.ts)):
 *    Ein Wert im PFAD eines GET steht danach in jedem Server- und Proxy-Log, in
 *    Analyse-Werkzeugen und im Verlauf jedes Werkzeugs, mit dem jemand den
 *    Endpunkt einmal von Hand aufruft. Eine Kopfzeile wird dort nicht
 *    mitgeschrieben. Beim Webhook ist das Pfad-Secret hingenommen, weil roapps
 *    Konfiguration nur eine URL entgegennimmt — hier gibt es diesen Zwang nicht.
 *    Dieselbe Überlegung, aus der das Website-Repo `?token=` für seine eigenen
 *    Cron-Endpunkte abgelehnt hat.
 *
 * Ohne Session laufen alle DB-Zugriffe über `service_role`, strikt auf die
 * aufgelöste `business_id` gescoped. Der Endpunkt liegt bewusst NICHT unter
 * `/portal` (kein Session-Kontext); die Middleware leitet nur für `/portal` um
 * und lässt ihn durch.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 1 = NUR FOTOS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Videos werden NICHT ausgeliefert — auch nicht erwähnt. Hat ein Auftrag
 * Videos, bleiben sie hier unsichtbar. Video ist ein eigener, späterer Schritt;
 * die `frame-*.jpg`-Vorschaubilder aus `lib/media/video-frames.ts` sind hier
 * ausdrücklich kein Gegenstand.
 *
 * Von den Fotos gehen nur `before` und `after` mit. `process` bleibt in
 * Handwerk: die Website hat für Prozessbilder keine Bildkategorie.
 *
 * ⚠️ `order_media.category` (before/after/process, Migration 0010) ist die
 *    LIVE-Einteilung. Die ältere Spalte `order_media.tag`
 *    (vorher/nachher/prozess, aus 0001) wird seit 6b.2 NICHT mehr gesetzt und
 *    ist nur noch in wenigen Altzeilen befüllt — sie wird hier NICHT gelesen.
 */

/** Gültigkeit der signierten Foto-Adressen. Projektweiter Wert (1 h). */
const SIGNED_URL_TTL_SECONDS = 3600;

/** Bucket, in dem alle Auftragsmedien liegen. */
const BUCKET = "order-media";

/**
 * Bild-Einteilungen, die die Website übernimmt. `process` fehlt bewusst.
 * Als Aufzählung geschrieben und nicht als `!== "process"`: käme je eine vierte
 * Einteilung dazu, soll sie eine Entscheidung erzwingen, statt stillschweigend
 * mitzufahren.
 */
const UEBERNOMMENE_BILDARTEN = ["before", "after"] as const;
type Bildart = (typeof UEBERNOMMENE_BILDARTEN)[number];

/** Der über das Secret aufgelöste Betrieb (Vertrauensquelle). */
type FeedBusiness = { id: string };

/** Eine Auftragszeile, wie sie aus `orders` gelesen wird. */
type FeedOrderRow = {
  id: string;
  external_ref: string | null;
  item_description: string | null;
  updated_at: string;
  website_category: string | null;
  website_clothing_type: string | null;
  website_work_hours: number | null;
  website_price: number | null;
};

/** Eine Medienzeile, wie sie aus `order_media` gelesen wird. */
type FeedMediaRow = {
  id: string;
  order_id: string;
  storage_path: string;
  category: string;
  caption: string | null;
  sort_order: number;
};

/** Ein Foto in der Antwort. */
type FeedPhoto = {
  id: string;
  /** `before` oder `after` — nie `process`. */
  kind: Bildart;
  caption: string | null;
  sort_order: number;
  /** Signierte Adresse, gültig `signed_url_ttl_seconds`. */
  url: string;
};

/** Ein Auftrag in der Antwort. */
type FeedOrder = {
  /** Handwerks Auftrags-ID. Die Website merkt sie sich als `handwerk_order_id`. */
  id: string;
  external_ref: string | null;
  /**
   * Ändert sich, sobald am Auftrag irgendetwas geschrieben wird (Trigger aus
   * 0001) — daran erkennt die Website, ob die vier Angaben unten nachgezogen
   * werden müssen.
   */
  updated_at: string;
  /** `aenderung` | `redesign` | `upcycling` (aus `orders.website_category`). */
  work_category: string | null;
  /** Spiegel des Website-Enums `kleidungsart` (aus `orders.website_clothing_type`). */
  clothing_type: string | null;
  work_hours: number | null;
  /**
   * ⚠️ EURO, nicht Cent. Der Feldname trägt die Einheit, weil genau hier schon
   * einmal eine ×100-Verwechslung dokumentiert war.
   */
  price_eur: number | null;
  /** Rohtext aus roapp — Ausgangsmaterial für die Texterzeugung der Website. */
  item_description: string | null;
  photos: FeedPhoto[];
  /**
   * `true`, wenn zu diesem Auftrag mindestens ein Foto NICHT signiert werden
   * konnte und deshalb in `photos` fehlt. Der Auftrag geht trotzdem mit, damit
   * ein einzelner Speicher-Schluckauf nicht das ganze Stück verschwinden lässt
   * — aber die Website kann die Übernahme aufschieben, statt ein halbes Stück
   * anzulegen. Im Normalfall `false`.
   */
  photos_incomplete: boolean;
};

/** 404 — das einzige harte Gate: fehlendes/unbekanntes Secret. */
function notFound(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

/**
 * Liest das Bearer-Token aus der `Authorization`-Kopfzeile.
 * Gibt `null` zurück, wenn die Kopfzeile fehlt, ein anderes Schema trägt oder
 * hinter `Bearer` nichts steht.
 */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/** Nur `before`/`after` sind eine übernommene Bildart. */
function istUebernommeneBildart(value: string): value is Bildart {
  return (UEBERNOMMENE_BILDARTEN as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const secret = bearerToken(request);
  // Ohne Token gar nicht erst in die DB — und NIE mit `null` suchen: ein
  // `.eq("website_pull_secret", null)` würde in PostgREST zu `is null` und
  // träfe jeden Betrieb OHNE Secret.
  if (!secret) return notFound();

  const service = createServiceClient();

  // AUTH (§14.2): Secret → Betrieb. Die EINZIGE Vertrauensquelle.
  const { data: business, error: bizError } = await service
    .from("businesses")
    .select("id")
    .eq("website_pull_secret", secret)
    .maybeSingle<FeedBusiness>();
  if (bizError) {
    console.error("website-feed: business lookup failed", {
      step: "secret_lookup",
      message: bizError.message,
    });
    // 500 und nicht 404: Ein Infrastruktur-Fehler ist etwas anderes als ein
    // ungültiges Secret. Die Website darf beim nächsten Lauf einfach erneut
    // fragen, statt den Zugang für abgelaufen zu halten.
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!business) return notFound();

  // Aufträge des Betriebs, die auf die Website sollen. `business_id` als Filter
  // zusätzlich zum `website_visible` — service_role umgeht RLS, der Scope muss
  // hier stehen.
  const { data: orderRows, error: ordersError } = await service
    .from("orders")
    .select(
      "id, external_ref, item_description, updated_at, website_category, website_clothing_type, website_work_hours, website_price",
    )
    .eq("business_id", business.id)
    .eq("website_visible", true)
    .order("updated_at", { ascending: false })
    .returns<FeedOrderRow[]>();
  if (ordersError) {
    console.error("website-feed: orders query failed", {
      business_id: business.id,
      step: "orders_query",
      message: ordersError.message,
    });
    return NextResponse.json({ error: "orders_failed" }, { status: 500 });
  }

  const orders = orderRows ?? [];
  if (orders.length === 0) {
    return NextResponse.json(
      {
        signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
        orders: [],
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  // Fotos aller sichtbaren Aufträge in EINER Abfrage. `media_type = 'photo'`
  // zusätzlich zur Bildart-Prüfung: Videos sind laut 0010 immer `process`, aber
  // darauf verlässt sich diese Route nicht — Phase 1 liefert nachweislich nur
  // Fotos aus.
  const orderIds = orders.map((o) => o.id);
  const { data: mediaRows, error: mediaError } = await service
    .from("order_media")
    .select("id, order_id, storage_path, category, caption, sort_order")
    .eq("business_id", business.id)
    .eq("media_type", "photo")
    .in("order_id", orderIds)
    .in("category", [...UEBERNOMMENE_BILDARTEN])
    .order("sort_order", { ascending: true })
    .returns<FeedMediaRow[]>();
  if (mediaError) {
    console.error("website-feed: media query failed", {
      business_id: business.id,
      step: "media_query",
      message: mediaError.message,
    });
    return NextResponse.json({ error: "media_failed" }, { status: 500 });
  }

  const media = mediaRows ?? [];

  // Alle Adressen in EINEM Aufruf signieren (statt einer Runde je Foto).
  const paths = media.map((m) => m.storage_path);
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed, error: signError } = await service.storage
      .from(BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    if (signError) {
      console.error("website-feed: signing failed", {
        business_id: business.id,
        step: "sign_urls",
        message: signError.message,
      });
      // Kein Abbruch: die Aufträge gehen mit, jeder mit `photos_incomplete`.
      // Die Website sieht dann, dass etwas fehlt, statt ein halbes Stück
      // anzulegen.
    }
    (signed ?? []).forEach((entry, index) => {
      const path = paths[index];
      if (path && !entry.error && entry.signedUrl) {
        urlByPath.set(path, entry.signedUrl);
      }
    });
  }

  const photosByOrder = new Map<string, FeedPhoto[]>();
  const incompleteOrders = new Set<string>();
  for (const m of media) {
    if (!istUebernommeneBildart(m.category)) continue; // defensiv, DB filtert bereits
    const url = urlByPath.get(m.storage_path);
    if (!url) {
      incompleteOrders.add(m.order_id);
      console.error("website-feed: photo url missing", {
        business_id: business.id,
        order_id: m.order_id,
        media_id: m.id,
        step: "sign_urls",
      });
      continue;
    }
    const list = photosByOrder.get(m.order_id) ?? [];
    list.push({
      id: m.id,
      kind: m.category,
      caption: m.caption,
      sort_order: m.sort_order,
      url,
    });
    photosByOrder.set(m.order_id, list);
  }

  const payload: FeedOrder[] = orders.map((o) => ({
    id: o.id,
    external_ref: o.external_ref,
    updated_at: o.updated_at,
    work_category: o.website_category,
    clothing_type: o.website_clothing_type,
    work_hours: o.website_work_hours,
    price_eur: o.website_price,
    item_description: o.item_description,
    photos: photosByOrder.get(o.id) ?? [],
    photos_incomplete: incompleteOrders.has(o.id),
  }));

  return NextResponse.json(
    {
      /**
       * Wie lange die `url`-Werte gültig sind. Die Website ruft alle 15 Minuten
       * ab — die Adressen überdauern also mehrere Läufe. Sie sind trotzdem
       * NICHT zum Verlinken gedacht: die Website lädt die Datei herunter und
       * legt sie in ihrem eigenen Speicher ab.
       */
      signed_url_ttl_seconds: SIGNED_URL_TTL_SECONDS,
      orders: payload,
    },
    // Ein Zwischenspeicher würde abgelaufene Foto-Adressen ausliefern und
    // frisch eingeschaltete Stücke verzögern.
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
