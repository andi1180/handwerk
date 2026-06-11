import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { PHOTO_COUNT, VIDEO_COUNT, VIDEO_SECONDS } from "@/lib/settings/options";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Capture } from "./capture";
import { MediaList, type MediaWithUrl } from "./media-list";
import { FinalizeBanner, FinalizeButton } from "./finalize-controls";
import {
  GenerateButton,
  GeneratedBanner,
  ReelButton,
  type ReelStatus,
} from "./generate-controls";
import { getOrderById, getOrderMedia } from "@/lib/orders/queries";

const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Signed-URLs sind kurzlebig — der private Bucket gibt nichts dauerhaft frei. */
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Auftrags-Detailseite (Server Component, mobile-first). Lädt den Auftrag über
 * den AUTHENTICATED Client (RLS skopiert auf den Betrieb; fremde/fehlende id →
 * `notFound()`) sowie dessen Medien und erzeugt pro Medium **server-seitig** eine
 * Signed-URL (privater Bucket `order-media`).
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const order = await getOrderById(id);
  if (!order) notFound();

  const media = await getOrderMedia(order.id);

  // Pro-Betrieb konfiguriertes Video-Limit (Settings 5a) an den Capture geben.
  const business = await getCurrentBusiness();
  const maxVideoSeconds =
    business?.settings.video_max_seconds ?? VIDEO_SECONDS.default;

  // Medien-Anzahl-Limit (8c): Fotos/Videos getrennt zählen + die pro-Betrieb-
  // Limits an den Capture geben (Client-Disable; der harte Riegel ist der
  // Server-Guard im Media-Route-Handler).
  const photoCount = media.filter((m) => m.media_type === "photo").length;
  const videoCount = media.filter((m) => m.media_type === "video").length;
  const photoMax = business?.settings.photo_max_count ?? PHOTO_COUNT.default;
  const videoMax = business?.settings.video_max_count ?? VIDEO_COUNT.default;

  const supabase = await createClient();
  const mediaWithUrls: MediaWithUrl[] = await Promise.all(
    media.map(async (item) => {
      const { data } = await supabase.storage
        .from("order-media")
        .createSignedUrl(item.storage_path, SIGNED_URL_TTL_SECONDS);
      return { ...item, signedUrl: data?.signedUrl ?? null };
    }),
  );

  // Editier-Modus nur im Entwurf (6c). Abgeschlossene/spätere Stufen sind
  // read-only. `finalized` lässt sich abschließen/erzeugen, `generated` neu
  // erzeugen — beide auch wieder öffnen (Reopen), solange nicht versendet.
  const isDraft = order.status === "draft";
  const isFinalized = order.status === "finalized";
  const isGenerated = order.status === "generated";

  // Booklet-Token für den Vorschau-Link (8a-2) + Reel-Status (8b-1a) laden. RLS
  // lässt Mitglieder die booklets-Row lesen — kein service_role nötig. Nur
  // relevant, sobald generiert. reel_status ist persistent (Reload zeigt den
  // Render-Stand); bei `ready` zusätzlich eine frische Signed-URL des Reels.
  let bookletToken: string | null = null;
  let reelStatus: ReelStatus = "pending";
  let reelUrl: string | null = null;
  if (isGenerated) {
    const { data: booklet } = await supabase
      .from("booklets")
      .select("access_token, reel_status, reel_url")
      .eq("order_id", order.id)
      .maybeSingle<{
        access_token: string;
        reel_status: ReelStatus | null;
        reel_url: string | null;
      }>();
    bookletToken = booklet?.access_token ?? null;
    reelStatus = booklet?.reel_status ?? "pending";
    if (reelStatus === "ready" && booklet?.reel_url) {
      const { data } = await supabase.storage
        .from("order-media")
        .createSignedUrl(booklet.reel_url, SIGNED_URL_TTL_SECONDS);
      reelUrl = data?.signedUrl ?? null;
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      {/* Dauerhaft sichtbarer Kopf: Kundenname + Status. Sticky; klinkt auf
          Mobile unter die Portal-Top-Bar ein (CSS-Offset --portal-topbar-h). */}
      <div className="order-detail-head">
        <Link
          href="/portal/orders"
          style={{
            display: "inline-block",
            fontSize: 14,
            color: "var(--text-secondary)",
            textDecoration: "none",
          }}
        >
          ← {t(DEFAULT_LOCALE, "orderDetail.back")}
        </Link>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 10,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {order.customer_name}
          </h1>
          <div style={{ flexShrink: 0 }}>
            <OrderStatusBadge status={order.status} />
          </div>
        </div>
      </div>

      {/* Abgeschlossen-Banner + „Wieder bearbeiten" (nur Status finalized). */}
      {isFinalized ? <FinalizeBanner orderId={order.id} /> : null}

      {/* Generiert-Banner + „Vorschau öffnen"/„Neu generieren"/„Wieder bearbeiten". */}
      {isGenerated ? (
        <GeneratedBanner orderId={order.id} token={bookletToken} />
      ) : null}

      {/* Stammdaten. */}
      <div
        className="card"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {order.external_ref ? (
          <MetaRow
            label={t(DEFAULT_LOCALE, "orders.externalRef")}
            value={order.external_ref}
          />
        ) : null}
        {order.customer_email ? (
          <MetaRow
            label={t(DEFAULT_LOCALE, "orders.email")}
            value={order.customer_email}
          />
        ) : null}
        {order.customer_phone ? (
          <MetaRow
            label={t(DEFAULT_LOCALE, "orders.phone")}
            value={order.customer_phone}
          />
        ) : null}
        {order.item_description ? (
          <MetaRow
            label={t(DEFAULT_LOCALE, "orders.itemDescription")}
            value={order.item_description}
          />
        ) : null}
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {DATE_FORMAT.format(new Date(order.created_at))}
        </div>
      </div>

      {/* Medien. */}
      <section>
        <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700 }}>
          {t(DEFAULT_LOCALE, "orderDetail.media")}
        </h2>

        {/* Foto-/Video-Capture (Client): zeigt Pending-Items, bis router.refresh()
            sie in die Medien-Liste überführt. Nur im Editier-Modus (Entwurf). */}
        {isDraft ? (
          <Capture
            businessId={order.business_id}
            orderId={order.id}
            maxVideoSeconds={maxVideoSeconds}
            photoMax={photoMax}
            videoMax={videoMax}
            photoCount={photoCount}
            videoCount={videoCount}
          />
        ) : null}

        {/* Mobiler Assembler (6a): Kachel-Raster, Reorder + Löschen. Im
            Abgeschlossen-Modus read-only (nur Ansehen/Abspielen). */}
        <div style={{ marginTop: 16 }}>
          <MediaList
            orderId={order.id}
            items={mediaWithUrls}
            readOnly={!isDraft}
          />
        </div>
      </section>

      {/* Prominenter Abschluss-Button am Seitenende (nur Status draft, 6c). */}
      {isDraft ? (
        <FinalizeButton orderId={order.id} mediaCount={media.length} />
      ) : null}

      {/* Vorschau erzeugen am Seitenende (nur Status finalized, 8a-1). */}
      {isFinalized ? (
        <GenerateButton orderId={order.id} mediaCount={media.length} />
      ) : null}

      {/* Echtes Foto-Reel (nur Status generated, 8b-1a): async Render + Poll. */}
      {isGenerated ? (
        <ReelButton
          orderId={order.id}
          initialStatus={reelStatus}
          initialUrl={reelUrl}
        />
      ) : null}
    </div>
  );
}

/** Beschriftete Stammdaten-Zeile (Label links, Wert rechts; mobil-tauglich). */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 14 }}>
      <span
        style={{
          minWidth: 110,
          flexShrink: 0,
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </span>
      <span style={{ wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

