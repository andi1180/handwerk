import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Capture } from "./capture";
import {
  getOrderById,
  getOrderMedia,
  type MediaTag,
  type OrderMedia,
} from "@/lib/orders/queries";

const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Signed-URLs sind kurzlebig — der private Bucket gibt nichts dauerhaft frei. */
const SIGNED_URL_TTL_SECONDS = 3600;

/** Medien-Item samt server-seitig erzeugter, befristeter Signed-URL. */
type MediaWithUrl = OrderMedia & { signedUrl: string | null };

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

  const supabase = await createClient();
  const mediaWithUrls: MediaWithUrl[] = await Promise.all(
    media.map(async (item) => {
      const { data } = await supabase.storage
        .from("order-media")
        .createSignedUrl(item.storage_path, SIGNED_URL_TTL_SECONDS);
      return { ...item, signedUrl: data?.signedUrl ?? null };
    }),
  );

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

        {/* Foto-Capture (Client): zeigt Pending-Items, bis router.refresh()
            sie in die unten server-gerenderte Liste überführt. */}
        <Capture businessId={order.business_id} orderId={order.id} />

        {mediaWithUrls.length === 0 ? (
          <div
            className="card"
            style={{
              textAlign: "center",
              padding: "32px 24px",
              color: "var(--text-secondary)",
            }}
          >
            {t(DEFAULT_LOCALE, "orderDetail.noMedia")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mediaWithUrls.map((item) => (
              <MediaListItem key={item.id} media={item} />
            ))}
          </div>
        )}
      </section>
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

/** Ein Medien-Eintrag: Thumbnail (Foto) bzw. inline-Player (Video), Keyword, Tag. */
function MediaListItem({ media }: { media: MediaWithUrl }) {
  // Video: inline abspielbar, damit der Mitarbeiter den Clip direkt prüfen kann.
  if (media.media_type === "video") {
    return (
      <div
        className="card"
        style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12 }}
      >
        {media.signedUrl ? (
          <video
            src={media.signedUrl}
            controls
            playsInline
            preload="metadata"
            style={{
              width: "100%",
              maxHeight: 360,
              borderRadius: "var(--radius)",
              background: "var(--surface-2)",
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 120,
              borderRadius: "var(--radius)",
              background: "var(--surface-2)",
            }}
          >
            <MediaTypeIcon type="video" size={28} />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MediaTypeIcon type="video" size={16} />
          {media.keyword ? (
            <span style={{ fontSize: 14, fontWeight: 600 }}>{media.keyword}</span>
          ) : null}
        </div>
        {media.tag ? <MediaTagBadge tag={media.tag} /> : null}
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{ display: "flex", alignItems: "center", gap: 14, padding: 12 }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          flexShrink: 0,
          borderRadius: "var(--radius)",
          overflow: "hidden",
          background: "var(--surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {media.media_type === "photo" && media.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Signed-URL aus privatem Bucket, kein next/image-Remote-Pattern nötig.
          <img
            src={media.signedUrl}
            alt={media.keyword ?? ""}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <MediaTypeIcon type={media.media_type} size={28} />
        )}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MediaTypeIcon type={media.media_type} size={16} />
          {media.keyword ? (
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {media.keyword}
            </span>
          ) : null}
        </div>
        {media.tag ? <MediaTagBadge tag={media.tag} /> : null}
      </div>
    </div>
  );
}

/** Pill mit dem (lokalisierten) Medien-Tag (vorher/nachher/prozess). */
function MediaTagBadge({ tag }: { tag: MediaTag }) {
  return (
    <span
      style={{
        display: "inline-flex",
        marginTop: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: "var(--gold-light)",
        border: "1px solid var(--gold-border)",
        color: "#8A7320",
      }}
    >
      {t(DEFAULT_LOCALE, `mediaTag.${tag}`)}
    </span>
  );
}

/** Schlichtes Inline-SVG-Icon für den Medientyp (Foto/Video). Reine Deko. */
function MediaTypeIcon({
  type,
  size,
}: {
  type: "photo" | "video";
  size: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { color: "var(--text-secondary)", flexShrink: 0 },
    "aria-hidden": true,
  };

  if (type === "video") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
      <circle cx="12" cy="13.5" r="3.2" />
    </svg>
  );
}
