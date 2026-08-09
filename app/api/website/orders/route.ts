import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { videoFramePaths } from "@/lib/media/video-frames";

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
 * FOTOS (Phase 1) UND VIDEOS (Phase 2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Von den FOTOS gehen nur `before` und `after` mit. `process` bleibt in
 * Handwerk: die Website hat für Prozessbilder keine Bildkategorie.
 *
 * ⚠️ `order_media.category` (before/after/process, Migration 0010) ist die
 *    LIVE-Einteilung. Die ältere Spalte `order_media.tag`
 *    (vorher/nachher/prozess, aus 0001) wird seit 6b.2 NICHT mehr gesetzt und
 *    ist nur noch in wenigen Altzeilen befüllt — sie wird hier NICHT gelesen.
 *
 * VIDEOS gehen seit Phase 2 als eigene Liste mit, jeweils mit einem
 * Vorschaubild aus den client-seitig extrahierten Standbildern
 * (`lib/media/video-frames.ts`).
 *
 * ⚠️ Videos werden BEWUSST NICHT nach `category` gefiltert. Anders als bei den
 *    Fotos wäre das kein Filter, sondern ein Totalausschluss: `resolveCategory`
 *    im Upload-Handler zwingt JEDES Video auf `process` (0010), am Bestand
 *    gemessen 35 von 35 (08.08.2026). Videos tragen in der Antwort deshalb auch
 *    keine Bildart — die Vorher/Nachher-Achse gibt es für sie schlicht nicht.
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

/**
 * Welches der drei extrahierten Standbilder als Vorschaubild dient, mit
 * Ausweichreihenfolge. Die Indizes zeigen auf `VIDEO_FRAME_POSITIONS`
 * (`[0.1, 0.5, 0.9]` der Dauer):
 *
 *   1 (≈ 50 %) — bevorzugt: mittig im Clip, am ehesten aussagekräftig.
 *   0 (≈ 10 %) — Ausweich: näher am Geschehen als das Ende.
 *   2 (≈ 90 %) — letzte Wahl.
 *
 * ⚠️ Am Bestand gemessen (08.08.2026) existieren Frames immer alle drei oder
 *    gar nicht — die Ausweichstufen sind heute also totes Netz. Sie stehen
 *    trotzdem hier, weil `extract-frames.ts` einzelne Frames sehr wohl
 *    verwerfen kann (Schwarzbild-Prüfung, Seek-Zeitüberschreitung) und ein
 *    Video dann mit Lücken im Speicher landet.
 */
const PREVIEW_FRAME_PREFERENCE = [1, 0, 2] as const;

/** Der über das Secret aufgelöste Betrieb (Vertrauensquelle). */
type FeedBusiness = { id: string };

/** Eine Auftragszeile, wie sie aus `orders` gelesen wird. */
type FeedOrderRow = {
  id: string;
  external_ref: string | null;
  item_description: string | null;
  website_text: string | null;
  updated_at: string;
  website_category: string | null;
  website_clothing_type: string | null;
  website_work_hours: number | null;
  website_price: number | null;
  consent_given: boolean;
  consent_at: string | null;
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

/** Eine Videozeile, wie sie aus `order_media` gelesen wird. */
type FeedVideoRow = {
  id: string;
  order_id: string;
  storage_path: string;
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

/** Ein Video in der Antwort. */
type FeedVideo = {
  id: string;
  /** Signierte Adresse der Videodatei, gültig `signed_url_ttl_seconds`. */
  url: string;
  /**
   * Signierte Adresse eines extrahierten Standbilds (bevorzugt ≈ 50 % der
   * Dauer), oder `null`.
   *
   * ⚠️ `null` ist im Bestand der Normalfall, nicht die Ausnahme: die
   *    Frame-Extraktion greift erst seit Phase 1 und nur bei NEUEN Uploads —
   *    am 08.08.2026 hatten 6 von 35 Videos überhaupt Standbilder. Die Website
   *    braucht dafür einen eigenen Weg (eigenes Standbild ziehen oder ohne
   *    Vorschau anzeigen); ein fehlendes Vorschaubild ist kein Fehler.
   */
  preview_url: string | null;
  sort_order: number;
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
  /**
   * „Was wurde gemacht" — von Alina beim Umlegen des Schalters von Hand
   * geschrieben (Migration 0017), mindestens 80 Zeichen. DAS ist die
   * Textquelle: Die Website glättet ihn sprachlich und leitet den Titel daraus
   * ab; erfunden wird nichts.
   *
   * ⚠️ Kann bei Aufträgen, die VOR 0017 sichtbar geschaltet wurden, `null`
   *    sein — die Einbahn-Sperre lässt sie nicht mehr abschalten, und die
   *    Pflicht greift erst beim nächsten Speichern. Die Website schiebt solche
   *    Aufträge auf, statt sie ohne Text anzulegen.
   */
  website_text: string | null;
  /**
   * Annahmenotiz aus roapp.
   *
   * ⚠️ NICHT die Textquelle — hier stand einmal „Ausgangsmaterial für die
   *    Texterzeugung". Die Messung an echten Aufträgen (07.08.2026) hat das
   *    widerlegt: typische Werte sind Maße und Kürzel („Kleid Les Historis
   *    Gummi K M L 26 R 26 ,5 armale kurzen Armal lang 26 cm"), Länge 11 bis
   *    157 Zeichen. Daraus ließe sich nicht beschreiben, was gemacht wurde,
   *    sondern nur erfinden. Geht als Nebeninformation weiterhin mit.
   */
  item_description: string | null;
  /**
   * Einwilligung des Kunden in die Veröffentlichung (`orders.consent_given`,
   * aus 0001). Grundlage ist das schriftliche, unterschriebene Formular an der
   * Kassa — Handwerk hält hier nur fest, DASS es vorliegt.
   *
   * ⚠️ Die Website entscheidet damit, ob ein Stück ohne Wartezeit sichtbar sein
   *    darf. Handwerk prüft NICHT gegen dieses Feld: `website_visible` und
   *    `consent_given` sind zwei getrennte Angaben, der Feed gibt beide
   *    unverändert weiter.
   *
   * ⚠️ Seit 09.08.2026 setzen BEIDE Anlagewege (roapp-Webhook wie manueller)
   *    den Wert automatisch auf `true` — die Einwilligung wird an der Kassa bei
   *    jedem Stück eingeholt. Die frühere §13.5-Regel („per Webhook immer
   *    false") gilt nicht mehr.
   *
   *    Ältere Aufträge tragen weiterhin ihren damaligen Wert; ein rückwirkendes
   *    Setzen hat es bewusst NICHT gegeben. Wer drüben auf das Feld gated,
   *    sieht bei Aufträgen von vor der Umstellung also `false`.
   */
  consent_given: boolean;
  /**
   * Wann die Einwilligung erfasst wurde (`orders.consent_at`). Gesetzt genau
   * dann, wenn `consent_given` gesetzt wurde; sonst `null`.
   */
  consent_at: string | null;
  photos: FeedPhoto[];
  /**
   * `true`, wenn zu diesem Auftrag mindestens ein Foto NICHT signiert werden
   * konnte und deshalb in `photos` fehlt. Der Auftrag geht trotzdem mit, damit
   * ein einzelner Speicher-Schluckauf nicht das ganze Stück verschwinden lässt
   * — aber die Website kann die Übernahme aufschieben, statt ein halbes Stück
   * anzulegen. Im Normalfall `false`.
   *
   * ⚠️ Bezieht sich ausdrücklich NUR auf Fotos. Für Videos gibt es keine
   *    Entsprechung: konnte ein Video nicht signiert werden, fehlt es
   *    stillschweigend in `videos` (laut geloggt, für die Website aber nicht
   *    erkennbar). Bewusst so belassen — die Antwortform ist mit der Website
   *    abgestimmt, und Videos sind dort Beiwerk, keine Voraussetzung für die
   *    Übernahme eines Stücks.
   */
  photos_incomplete: boolean;
  /**
   * Videos des Auftrags, nach `sort_order`. Leeres Feld, wenn der Auftrag keine
   * Videos hat — nie `null`, nie fehlend.
   */
  videos: FeedVideo[];
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
      "id, external_ref, item_description, website_text, updated_at, website_category, website_clothing_type, website_work_hours, website_price, consent_given, consent_at",
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
  // zusätzlich zur Bildart-Prüfung: Videos sind laut 0010 immer `process` und
  // fielen durch den Bildart-Filter ohnehin heraus — aber darauf verlässt sich
  // diese Abfrage nicht. Videos holt die eigene Abfrage weiter unten.
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

  // ═══════════════════════════════════════════════════════════════════════════
  // VIDEOS (Phase 2)
  // ═══════════════════════════════════════════════════════════════════════════
  // Eigene Abfrage statt einer erweiterten Foto-Abfrage: der Foto-Pfad oben
  // bleibt damit unangetastet, und ein Fehlgriff hier kann die Fotos nicht
  // beschädigen. KEIN `category`-Filter (siehe Kopf: jedes Video ist `process`).
  const { data: videoRows, error: videoError } = await service
    .from("order_media")
    .select("id, order_id, storage_path, sort_order")
    .eq("business_id", business.id)
    .eq("media_type", "video")
    .in("order_id", orderIds)
    .order("sort_order", { ascending: true })
    .returns<FeedVideoRow[]>();
  if (videoError) {
    console.error("website-feed: video query failed", {
      business_id: business.id,
      step: "video_query",
      message: videoError.message,
    });
    // 500 und nicht „einfach ohne Videos ausliefern": ein leeres `videos` sähe
    // für die Website aus wie „dieser Auftrag hat keine Videos". Ein
    // Datenbankfehler soll nicht als Tatsachenbehauptung durchgehen; die
    // Website fragt in 15 Minuten erneut.
    return NextResponse.json({ error: "videos_failed" }, { status: 500 });
  }

  const videos = videoRows ?? [];
  const videosByOrder = new Map<string, FeedVideoRow[]>();
  for (const v of videos) {
    const list = videosByOrder.get(v.order_id) ?? [];
    list.push(v);
    videosByOrder.set(v.order_id, list);
  }

  // Welche Standbilder existieren? Frames sind KEINE `order_media`-Zeilen,
  // sondern Storage-Objekte unter dem Konventions-Pfad
  // `{video-pfad-ohne-endung}.frame-{i}.jpg` — es gibt also nichts abzufragen.
  // Der Auftragsordner wird gelistet, genau wie es die Portal-Detailseite tut
  // (list() vor createSignedUrls). Eine Auflistung je Auftrag mit Videos,
  // parallel.
  const previewPathByVideo = new Map<string, string>();
  if (videosByOrder.size > 0) {
    const listings = await Promise.all(
      [...videosByOrder.keys()].map(async (orderId) => {
        const folder = `${business.id}/${orderId}`;
        const { data, error } = await service.storage
          .from(BUCKET)
          .list(folder, { limit: 1000 });
        if (error) {
          console.error("website-feed: frame listing failed", {
            business_id: business.id,
            order_id: orderId,
            step: "list_frames",
            message: error.message,
          });
          // Kein Abbruch: ohne Auflistung gibt es für diesen Auftrag eben keine
          // Vorschaubilder. Die Videos selbst gehen trotzdem mit.
          return { orderId, folder, names: [] as string[] };
        }
        return { orderId, folder, names: (data ?? []).map((o) => o.name) };
      }),
    );
    for (const { orderId, folder, names } of listings) {
      const existing = new Set(names.map((n) => `${folder}/${n}`));
      for (const v of videosByOrder.get(orderId) ?? []) {
        const candidates = videoFramePaths(v.storage_path);
        for (const index of PREVIEW_FRAME_PREFERENCE) {
          const candidate = candidates[index];
          if (candidate && existing.has(candidate)) {
            previewPathByVideo.set(v.id, candidate);
            break;
          }
        }
      }
    }
  }

  // Videodateien und die ausgewählten Standbilder in EINEM Aufruf signieren.
  const videoPaths = [
    ...videos.map((v) => v.storage_path),
    ...previewPathByVideo.values(),
  ];
  const videoUrlByPath = new Map<string, string>();
  if (videoPaths.length > 0) {
    const { data: signed, error: signError } = await service.storage
      .from(BUCKET)
      .createSignedUrls(videoPaths, SIGNED_URL_TTL_SECONDS);
    if (signError) {
      console.error("website-feed: video signing failed", {
        business_id: business.id,
        step: "sign_video_urls",
        message: signError.message,
      });
      // Kein Abbruch — wie bei den Fotos. Die Aufträge gehen mit, die
      // betroffenen Videos fehlen.
    }
    (signed ?? []).forEach((entry, index) => {
      const path = videoPaths[index];
      if (path && !entry.error && entry.signedUrl) {
        videoUrlByPath.set(path, entry.signedUrl);
      }
    });
  }

  const videosByOrderPayload = new Map<string, FeedVideo[]>();
  for (const v of videos) {
    const url = videoUrlByPath.get(v.storage_path);
    if (!url) {
      console.error("website-feed: video url missing", {
        business_id: business.id,
        order_id: v.order_id,
        media_id: v.id,
        step: "sign_video_urls",
      });
      continue;
    }
    const previewPath = previewPathByVideo.get(v.id);
    // Kein Standbild vorhanden ODER es ließ sich nicht signieren ⇒ null. Beides
    // ist für die Website derselbe Fall: keine Vorschau.
    const previewUrl = previewPath
      ? (videoUrlByPath.get(previewPath) ?? null)
      : null;
    const list = videosByOrderPayload.get(v.order_id) ?? [];
    list.push({
      id: v.id,
      url,
      preview_url: previewUrl,
      sort_order: v.sort_order,
    });
    videosByOrderPayload.set(v.order_id, list);
  }

  const payload: FeedOrder[] = orders.map((o) => ({
    id: o.id,
    external_ref: o.external_ref,
    updated_at: o.updated_at,
    work_category: o.website_category,
    clothing_type: o.website_clothing_type,
    work_hours: o.website_work_hours,
    price_eur: o.website_price,
    website_text: o.website_text,
    item_description: o.item_description,
    consent_given: o.consent_given,
    consent_at: o.consent_at,
    photos: photosByOrder.get(o.id) ?? [],
    photos_incomplete: incompleteOrders.has(o.id),
    videos: videosByOrderPayload.get(o.id) ?? [],
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
