import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { PHOTO_COUNT, VIDEO_COUNT, VIDEO_SECONDS } from "@/lib/settings/options";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { CUSTOMER_VIEW_QUERY } from "@/lib/booklet/customer-view";
import { NO_TRACK_QUERY } from "@/lib/booklet/events";
import { Capture } from "./capture";
import { MediaList, type MediaWithUrl } from "./media-list";
import { FinalizeButton, ReopenButton } from "./finalize-controls";
import {
  GenerateButton,
  GeneratedActions,
  ReelButton,
  type ReelStatus,
} from "./generate-controls";
import { DeliverButton } from "./deliver-controls";
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

  // Versendet-Stufen (sent/viewed/shared): Booklet ist beim Kunden — Ansehen +
  // QR bleiben verfügbar, Erstellungs-/Auslieferungs-Aktionen entfallen.
  const isDelivered =
    order.status === "sent" ||
    order.status === "viewed" ||
    order.status === "shared";

  // Reel ist ab der Generierung renderbar — auch nach dem Versand
  // (sent/viewed/shared). FIX 7.1 (REVIEW): liefert ein Betrieb VOR dem
  // Reel-Render aus, wäre das Reel sonst dauerhaft un-renderbar (Sackgasse).
  // Der Render lässt den Order-Status unberührt; das Reel erscheint im
  // bestehenden Booklet unter demselben Link (kein Nachversand, keine E-Mail).
  const canRenderReel = isGenerated || isDelivered;

  // Booklet-Token für den Vorschau-Link (8a-2) + Reel-Status (8b-1a) + sent_at
  // (9c-1) laden. RLS lässt Mitglieder die booklets-Row lesen — kein service_role
  // nötig. Relevant ab `generated` (auch nach Versand für den Reel-Render).
  // reel_status ist persistent (Reload zeigt den Render-Stand); bei `ready`
  // zusätzlich eine frische Signed-URL des Reels.
  let bookletToken: string | null = null;
  let reelStatus: ReelStatus = "pending";
  let reelUrl: string | null = null;
  let sentAt: string | null = null;
  if (canRenderReel) {
    const { data: booklet } = await supabase
      .from("booklets")
      .select("access_token, reel_status, reel_url, sent_at")
      .eq("order_id", order.id)
      .maybeSingle<{
        access_token: string;
        reel_status: ReelStatus | null;
        reel_url: string | null;
        sent_at: string | null;
      }>();
    bookletToken = booklet?.access_token ?? null;
    reelStatus = booklet?.reel_status ?? "pending";
    sentAt = booklet?.sent_at ?? null;
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

      {/* Sekundäre Booklet-Aktionen (Layout-Umbau, ersetzt die früheren
          Top-Banner): kleine, dezente Leiste für ALLE Stufen mit Booklet
          (generated/sent/viewed/shared) — „Booklet ansehen" (`?c=1` Kunden-
          Sicht §9d + `&p=1` No-Track §10a.1) und „QR drucken" (9c-2); bei
          `generated` zusätzlich „Neu generieren" + „Bearbeiten". Die große
          Folge-Aktion (Erstellen/Ausliefern) lebt unten in der Aktionszone. */}
      {(isGenerated || isDelivered) && bookletToken ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            marginBottom: 20,
          }}
        >
          {isDelivered ? (
            <span
              style={{
                flexBasis: "100%",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--green-text)",
              }}
            >
              ✓{" "}
              {sentAt
                ? t(DEFAULT_LOCALE, "deliver.delivered", {
                    date: DATE_FORMAT.format(new Date(sentAt)),
                  })
                : t(DEFAULT_LOCALE, "deliver.deliveredNoDate")}
            </span>
          ) : null}
          <a
            className="btn-outline"
            href={`/b/${bookletToken}?${CUSTOMER_VIEW_QUERY}&${NO_TRACK_QUERY}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t(DEFAULT_LOCALE, "generate.openPreview")}
          </a>
          <a
            className="btn-outline"
            href={`/portal/orders/${order.id}/qr`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t(DEFAULT_LOCALE, "qr.printButton")}
          </a>
          {isGenerated ? <GeneratedActions orderId={order.id} /> : null}
        </div>
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

      {/* ───── Aktionszone am Seitenende: immer die nächste fällige Aktion. ───── */}

      {/* draft: „Booklet erstellen" (POSTet finalize — Schritt 1, kein Confirm,
          kein Chaining; nach dem Refresh erscheint an derselben Stelle Schritt 2). */}
      {isDraft ? (
        <FinalizeButton orderId={order.id} mediaCount={media.length} />
      ) : null}

      {/* finalized: „Booklet erstellen" (POSTet generate, 8a-1) — mit
          Fortschritts-Häkchen („Medien abgeschlossen") + kleinem „Bearbeiten"
          (Reopen). Dient zugleich als Recovery, falls generate scheiterte. */}
      {isFinalized ? (
        <div style={{ marginTop: 24 }}>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "#8A7320",
            }}
          >
            ✓ {t(DEFAULT_LOCALE, "finalize.done")}
          </p>
          <GenerateButton orderId={order.id} mediaCount={media.length} />
          <ReopenButton orderId={order.id} />
        </div>
      ) : null}

      {/* Reel-Block (8b-1a): async Render + Poll, eigener Abschnitt. Ab
          `generated` und AUCH nach dem Versand (FIX 7.1) — so lässt sich ein
          Reel nachträglich erzeugen, falls vor dem Render ausgeliefert wurde.
          Der Render ändert den Order-Status nicht; das Reel erscheint im
          bestehenden Booklet-Link. */}
      {canRenderReel ? (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            {t(DEFAULT_LOCALE, "reel.title")}
          </h2>
          <ReelButton
            orderId={order.id}
            initialStatus={reelStatus}
            initialUrl={reelUrl}
          />
        </section>
      ) : null}

      {/* Auslieferung (nur Status generated, 9c-1): die finale Aktion. Warnt,
          wenn das Reel noch rendert oder keine E-Mail hinterlegt ist (kein Block). */}
      {isGenerated ? (
        <DeliverButton
          orderId={order.id}
          hasEmail={Boolean(order.customer_email)}
          reelReady={reelStatus === "ready"}
          connectorEnabled={business?.settings.connector_roapp_enabled ?? true}
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

