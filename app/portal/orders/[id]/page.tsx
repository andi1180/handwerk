import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { VIDEO_SECONDS } from "@/lib/settings/options";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { Capture } from "./capture";
import { MediaList, type MediaWithUrl } from "./media-list";
import { FinalizeBanner, FinalizeButton } from "./finalize-controls";
import {
  GenerateButton,
  GeneratedBanner,
  ReelTestButton,
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

  // Booklet-Token für den Vorschau-Link laden (8a-2). RLS lässt Mitglieder die
  // booklets-Row lesen — kein service_role nötig. Nur relevant, sobald generiert.
  let bookletToken: string | null = null;
  if (isGenerated) {
    const { data: booklet } = await supabase
      .from("booklets")
      .select("access_token")
      .eq("order_id", order.id)
      .maybeSingle<{ access_token: string }>();
    bookletToken = booklet?.access_token ?? null;
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

      {/* Provisorischer FFmpeg-Infra-Test (nur Status generated, 8b-0v2). Wird in
          8b-1 durch das echte „Reel erstellen" ersetzt. */}
      {isGenerated ? <ReelTestButton orderId={order.id} /> : null}
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

