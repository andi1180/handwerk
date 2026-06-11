// Server-only. NIEMALS in Client Components importieren (nutzt service_role).
import { createServiceClient } from "@/lib/supabase/service";
import {
  normalizeBranding,
  normalizeSettings,
  type BusinessBranding,
  type BusinessSettings,
} from "@/lib/auth/current-business";

/** Signed-URLs sind kurzlebig — die Seite rendert pro Request frisch. */
const SIGNED_URL_TTL_SECONDS = 3600;

/** Ein Medien-Item der öffentlichen Web-Story (mit frischer Signed-URL). */
export type PublicBookletMedia = {
  id: string;
  media_type: "photo" | "video";
  signedUrl: string | null;
  /** Roh — der Render entscheidet das Overlay über `displayCaption`. */
  caption: string | null;
  keyword: string | null;
};

/** Vollständig zusammengesetzte Daten der öffentlichen Web-Story. */
export type PublicBookletData = {
  businessName: string;
  branding: BusinessBranding;
  settings: BusinessSettings;
  introTitle: string | null;
  introDescription: string | null;
  /**
   * Google-Review-Entwurf (Schritt 9b) — bei der Generierung erzeugt (Sonnet),
   * NICHT auf der öffentlichen Seite. Der Kunde kopiert ihn als Vorschlag (§8.6).
   */
  reviewDraft: string | null;
  /** IG-Caption-Vorschlag (Schritt 9b, Template) — Kunde kopiert ihn für den IG-Post. */
  igCaption: string | null;
  language: string;
  /** Server-seitig signierte URLs (privater Bucket `branding`), sonst null. */
  logoUrl: string | null;
  introBgUrl: string | null;
  outroBgUrl: string | null;
  /** Signierte Reel-URL (Bucket order-media) — nur wenn reel_status='ready', sonst null. */
  reelSignedUrl: string | null;
  media: PublicBookletMedia[];
};

/**
 * Ergebnis des Token-Lookups:
 *  - `not_found`  → Seite ruft `notFound()` (404).
 *  - `expired`    → einfache „nicht mehr verfügbar"-Seite.
 *  - `ok`         → Story rendern.
 */
export type PublicBookletResult =
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "ok"; data: PublicBookletData };

type BookletRow = {
  business_id: string;
  order_id: string;
  intro_title: string | null;
  intro_description: string | null;
  review_draft: string | null;
  ig_caption: string | null;
  language: string;
  expires_at: string | null;
  reel_status: string | null;
  reel_url: string | null;
};

type BusinessRow = {
  name: string;
  branding: unknown;
  settings: unknown;
};

type MediaRow = {
  id: string;
  media_type: "photo" | "video";
  storage_path: string;
  caption: string | null;
  keyword: string | null;
};

/**
 * Signiert mehrere Storage-Pfade desselben Buckets in einem Aufruf und gibt
 * eine `Pfad → Signed-URL`-Map zurück (fehlgeschlagene Pfade fehlen schlicht).
 */
async function signPaths(
  service: ReturnType<typeof createServiceClient>,
  bucket: string,
  paths: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(paths)].filter((p) => p.length > 0);
  if (unique.length === 0) return map;

  const { data } = await service.storage
    .from(bucket)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);

  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) {
      map.set(row.path, row.signedUrl);
    }
  }
  return map;
}

/**
 * Lädt die öffentliche Web-Story zu einem `access_token` (Schritt 8a-2).
 *
 * SICHERHEIT (§14.2): ausschließlich `service_role` (kein anon-SELECT). Der
 * TOKEN ist die einzige vertrauenswürdige Quelle: token → booklets-Row →
 * `business_id`. ALLE weiteren Reads (business, order_media, Signing) sind
 * strikt auf diese `business_id`/`order_id` aus der Booklet-Row gescoped —
 * niemals aus URL/Client abgeleitet außer dem Token selbst.
 */
export async function loadPublicBooklet(
  token: string,
): Promise<PublicBookletResult> {
  const service = createServiceClient();

  // 1) Token → Booklet (access_token ist unique). Nicht gefunden ⇒ 404.
  const { data: booklet } = await service
    .from("booklets")
    .select(
      "business_id, order_id, intro_title, intro_description, review_draft, ig_caption, language, expires_at, reel_status, reel_url",
    )
    .eq("access_token", token)
    .maybeSingle<BookletRow>();
  if (!booklet) return { status: "not_found" };

  // 2) Ablauf: gesetzt UND vergangen ⇒ „nicht mehr verfügbar". In 8a ist
  //    expires_at null (forward-compat).
  if (
    booklet.expires_at &&
    new Date(booklet.expires_at).getTime() < Date.now()
  ) {
    return { status: "expired" };
  }

  // 3) Betrieb (Branding + Settings) — strikt über die business_id der Booklet-Row.
  const { data: business } = await service
    .from("businesses")
    .select("name, branding, settings")
    .eq("id", booklet.business_id)
    .maybeSingle<BusinessRow>();
  if (!business) return { status: "not_found" };

  // 4) Medien — über order_id, zusätzlich defensiv auf die booklet-business_id
  //    gescoped; sort_order ASC.
  const { data: mediaRows } = await service
    .from("order_media")
    .select("id, media_type, storage_path, caption, keyword")
    .eq("order_id", booklet.order_id)
    .eq("business_id", booklet.business_id)
    .order("sort_order", { ascending: true })
    .returns<MediaRow[]>();
  const rows = mediaRows ?? [];

  // 5) Signieren: Medien (Bucket order-media) + Branding-Bilder (Bucket branding).
  const branding = normalizeBranding(business.branding);
  const settings = normalizeSettings(business.settings);

  // Reel nur signieren, wenn fertig gerendert (reel_status='ready'). Es liegt im
  // selben Bucket order-media → zusammen mit den Medien in einem Batch signieren.
  const reelPath =
    booklet.reel_status === "ready" && booklet.reel_url
      ? booklet.reel_url
      : null;

  const mediaUrls = await signPaths(service, "order-media", [
    ...rows.map((m) => m.storage_path),
    ...(reelPath ? [reelPath] : []),
  ]);
  const brandingUrls = await signPaths(
    service,
    "branding",
    [branding.logo_url, branding.intro_bg_url, branding.outro_bg_url].filter(
      (p): p is string => p !== null,
    ),
  );
  const signedBranding = (path: string | null): string | null =>
    path ? (brandingUrls.get(path) ?? null) : null;

  return {
    status: "ok",
    data: {
      businessName: business.name,
      branding,
      settings,
      introTitle: booklet.intro_title,
      introDescription: booklet.intro_description,
      reviewDraft: booklet.review_draft,
      igCaption: booklet.ig_caption,
      language: booklet.language,
      logoUrl: signedBranding(branding.logo_url),
      introBgUrl: signedBranding(branding.intro_bg_url),
      outroBgUrl: signedBranding(branding.outro_bg_url),
      reelSignedUrl: reelPath ? (mediaUrls.get(reelPath) ?? null) : null,
      media: rows.map((m) => ({
        id: m.id,
        media_type: m.media_type,
        signedUrl: mediaUrls.get(m.storage_path) ?? null,
        caption: m.caption,
        keyword: m.keyword,
      })),
    },
  };
}
