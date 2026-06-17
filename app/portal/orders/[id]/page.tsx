import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { PHOTO_COUNT, VIDEO_COUNT, VIDEO_SECONDS } from "@/lib/settings/options";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { CUSTOMER_VIEW_QUERY } from "@/lib/booklet/customer-view";
import { NO_TRACK_QUERY } from "@/lib/booklet/events";
import { MediaSection } from "./media-section";
import type { MediaWithUrl } from "./media-list";
import {
  CreateBookletButton,
  ReopenButton,
  ReelCreateButton,
  ReelWatchButton,
  type ReelStatus,
} from "./generate-controls";
import { DeliverButton } from "./deliver-controls";
import { getOrderById, getOrderMedia } from "@/lib/orders/queries";
import { videoFramePaths } from "@/lib/media/video-frames";

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

  // Vorher-/Nachher-Slot je max 1 (0010): dem Capture mitgeben, damit die jeweilige
  // Kategorie-Auswahl gesperrt ist, sobald ein Slot belegt ist (Server prüft zusätzlich).
  const hasBefore = media.some((m) => m.category === "before");
  const hasAfter = media.some((m) => m.category === "after");

  // Booklet-Erstellung verlangt mindestens EIN process-Medium (0010) — nur
  // before/after ist nicht erstellbar. Der Client-Guard ist UX; der Server prüft
  // zusätzlich (generate ⇒ need_process). Videos sind immer process.
  const processCount = media.filter((m) => m.category === "process").length;

  const supabase = await createClient();

  // Phase 1 (Video-Vorschau-Frames): Die extrahierten Frames sind KEINE
  // order_media-Zeilen, sondern Storage-Objekte unter dem Konventions-Pfad
  // {video-pfad}.frame-{i}.jpg. Den Auftrags-Ordner einmal listen (RLS +
  // 0002-Präfix-Policy, AUTHENTICATED — kein service_role) und daraus je Video
  // die tatsächlich vorhandenen Frame-Pfade bestimmen, dann signieren.
  const orderFolder = `${order.business_id}/${order.id}`;
  const { data: folderObjects } = await supabase.storage
    .from("order-media")
    .list(orderFolder, { limit: 1000 });
  const existingPaths = new Set(
    (folderObjects ?? []).map((o) => `${orderFolder}/${o.name}`),
  );
  const frameTargets = media
    .filter((m) => m.media_type === "video")
    .map((m) => ({
      id: m.id,
      paths: videoFramePaths(m.storage_path).filter((p) => existingPaths.has(p)),
    }))
    .filter((t) => t.paths.length > 0);

  const frameUrlsByMedia = new Map<string, string[]>();
  const allFramePaths = frameTargets.flatMap((t) => t.paths);
  if (allFramePaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("order-media")
      .createSignedUrls(allFramePaths, SIGNED_URL_TTL_SECONDS);
    const urlByPath = new Map<string, string>();
    (signed ?? []).forEach((s, idx) => {
      const path = allFramePaths[idx];
      if (path && !s.error && s.signedUrl) urlByPath.set(path, s.signedUrl);
    });
    for (const t of frameTargets) {
      const urls = t.paths
        .map((p) => urlByPath.get(p))
        .filter((u): u is string => Boolean(u));
      if (urls.length > 0) frameUrlsByMedia.set(t.id, urls);
    }
  }

  const mediaWithUrls: MediaWithUrl[] = await Promise.all(
    media.map(async (item) => {
      const { data } = await supabase.storage
        .from("order-media")
        .createSignedUrl(item.storage_path, SIGNED_URL_TTL_SECONDS);
      return {
        ...item,
        signedUrl: data?.signedUrl ?? null,
        frameUrls: frameUrlsByMedia.get(item.id) ?? [],
      };
    }),
  );

  // Editier-Modus nur im Entwurf. Spätere Stufen sind read-only. Es gibt keinen
  // `finalized`-Zwischenschritt mehr: ein Klick „Booklet erstellen" führt direkt
  // `draft → generated`; `generated` lässt sich neu erzeugen oder über
  // „Bearbeiten" (Reopen) wieder öffnen, solange nicht versendet.
  const isDraft = order.status === "draft";
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
            {/* draft → „Neu"/„In Arbeit" abgeleitet aus der Medien-Existenz
                (kein neuer Status). Medien sind hier ohnehin geladen ⇒ keine
                Extra-Query. */}
            <OrderStatusBadge
              status={order.status}
              hasMedia={media.length > 0}
            />
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

        {/* Capture (Client) + MediaList in einem Client-Wrapper, damit nach dem
            Frame-Upload kein zweiter router.refresh() nötig ist. Stattdessen
            reicht der Wrapper die frisch signierten Frame-URLs per Callback direkt
            in den MediaList-State — kein src-Swap an bestehenden Video-Kacheln. */}
        <MediaSection
          orderId={order.id}
          businessId={order.business_id}
          initialItems={mediaWithUrls}
          isDraft={isDraft}
          maxVideoSeconds={maxVideoSeconds}
          photoMax={photoMax}
          videoMax={videoMax}
          photoCount={photoCount}
          videoCount={videoCount}
          hasBefore={hasBefore}
          hasAfter={hasAfter}
        />
      </section>

      {/* ───── Aktionszone (Control Center) am Seitenende ─────
          Alle Folge-Aktionen gebündelt an EINER Stelle (statt oben verstreut).
          Die Routen-/Status-Logik ist unverändert; nur Anordnung + Benennung. */}

      {/* draft: EIN großer „Booklet erstellen" über die volle Breite. Ohne
          Prozess-Medium gar kein Button (Validierung need_process bleibt
          client- UND serverseitig) — es gibt dann nichts zu erstellen. */}
      {isDraft && processCount >= 1 ? (
        <section style={{ marginTop: 32 }}>
          <CreateBookletButton orderId={order.id} processCount={processCount} />
        </section>
      ) : null}

      {/* generated / sent / viewed / shared: gebündeltes Control Center.
            1) Zustands-Bestätigung (grau „✓ Booklet erstellt" bzw. „✓ Ausgeliefert").
            2) „Reel erstellen" (aktiv) bzw. „✓ Reel erstellt" (grau).
            3) nur generated: „Bearbeiten" | „Ausliefern".
            4) Ansehen-Aktionen: Booklet ansehen · [Reel ansehen] · QR drucken. */}
      {isGenerated || isDelivered ? (
        <section className="booklet-cc">
          {/* 1) Wo der Auftrag steht. generated ⇒ Booklet ist erstellt (grau,
              regenerieren via „Bearbeiten"); versendet ⇒ Ausgeliefert-Hinweis. */}
          {isGenerated ? (
            <CreateBookletButton
              orderId={order.id}
              processCount={processCount}
              disabled
            />
          ) : (
            <p className="booklet-cc-delivered">
              ✓{" "}
              {sentAt
                ? t(DEFAULT_LOCALE, "deliver.delivered", {
                    date: DATE_FORMAT.format(new Date(sentAt)),
                  })
                : t(DEFAULT_LOCALE, "deliver.deliveredNoDate")}
            </p>
          )}

          {/* 2) Reel: erstellen / rendert / „✓ Reel erstellt". Ab `generated`
              renderbar — auch nach Versand (FIX 7.1: der Render lässt den
              Order-Status unberührt, das Reel erscheint im bestehenden Link). */}
          <ReelCreateButton orderId={order.id} initialStatus={reelStatus} />

          {/* 3) nur generated: „Bearbeiten" (Reopen) | „Ausliefern" (deliver,
              unveränderte Logik inkl. Safe-Mode/Connector/Doppelversand-Guard).
              Versendet lässt sich weder zurückdrehen noch erneut ausliefern. */}
          {isGenerated ? (
            <div className="booklet-actions-row">
              <ReopenButton orderId={order.id} />
              <DeliverButton
                orderId={order.id}
                hasEmail={Boolean(order.customer_email)}
                reelReady={reelStatus === "ready"}
                connectorEnabled={
                  business?.settings.connector_roapp_enabled ?? true
                }
              />
            </div>
          ) : null}

          {/* 4) Ansehen-Aktionen, gebündelt (vorher oben verstreut): „Booklet
              ansehen" (`?c=1` Kunden-Sicht §9d + `&p=1` No-Track §10a.1; gleiche
              Domain, same-tab — die Vorschau hat einen Zurück-Button),
              optional „Reel ansehen" (In-App-Overlay) und „QR drucken". */}
          {bookletToken ? (
            <div className="booklet-cc-views">
              <a
                className="btn-outline"
                href={`/b/${bookletToken}?${CUSTOMER_VIEW_QUERY}&${NO_TRACK_QUERY}`}
              >
                {t(DEFAULT_LOCALE, "generate.openPreview")}
              </a>
              {reelUrl ? <ReelWatchButton url={reelUrl} /> : null}
              <a
                className="btn-outline"
                href={`/portal/orders/${order.id}/qr`}
              >
                {t(DEFAULT_LOCALE, "qr.printButton")}
              </a>
            </div>
          ) : null}
        </section>
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

