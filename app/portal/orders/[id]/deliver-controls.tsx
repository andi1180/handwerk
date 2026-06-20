"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Auslieferung im Portal (Schritt 9c-1). Eine kleine Client-Komponente,
 * `div + onClick`, kein `<form>`:
 *
 *  - `<DeliverButton>` (Status `generated`): prominenter „Booklet ausliefern"-
 *    Button am Seitenende. Bestätigungsdialog mit bewussten Warnungen (Reel noch
 *    nicht fertig / kein Kontakt — KEIN harter Block), dann `POST deliver` →
 *    `router.refresh()`. Das Sende-Ergebnis (Kanal E-Mail/SMS bzw. Fehlergrund,
 *    Feature 3a) wird einmalig gemeldet; der Auftrag gilt in jedem Fall als
 *    ausgeliefert.
 *
 * Die Ausgeliefert-Info + der „Booklet ansehen"-Link leben seit dem Layout-Umbau
 * server-seitig in der oberen Aktionsleiste der Detailseite (kein Banner mehr).
 *
 * ISOLATION: kein Body; Betrieb/Order werden im Route Handler gegen die Session
 * geprüft, die `business_id` stammt aus der geladenen Order.
 */

/** Antwortet der Versand (Resend) nicht, wird hart abgebrochen. */
const DELIVER_TIMEOUT_MS = 30_000;

/** POST auf `deliver` (kein Body) mit AbortController-Timeout. */
async function postDeliver(orderId: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVER_TIMEOUT_MS);
  try {
    return await fetch(`/api/portal/orders/${orderId}/deliver`, {
      method: "POST",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Roter Hinweis-Kasten. */
function NoticeBox({ text }: { text: string }) {
  return (
    <div
      role="alert"
      className="card"
      style={{
        marginTop: 12,
        padding: 12,
        fontSize: 13,
        color: "#B23B3B",
        borderColor: "var(--border)",
      }}
    >
      {text}
    </div>
  );
}

/**
 * „Booklet ausliefern"-Button (Status `generated`).
 *
 * Verhalten abhängig vom roapp-Connector (Block B, Punkt 3):
 *  - Connector AN (Default): prominent (`btn-gold`) + Safe-Mode-Rückfrage, weil
 *    die Auslieferung normalerweise automatisch über roapp läuft.
 *  - Connector AUS: sekundär gestylt (`btn-dark`, dezent) — manuelles Senden ist
 *    hier der Normalweg; keine Connector-Warnung. Die bewussten Reel-/E-Mail-
 *    Hinweise bleiben in beiden Fällen erhalten (kein harter Block).
 */
export function DeliverButton({
  orderId,
  hasEmail,
  hasPhone,
  reelReady,
  connectorEnabled,
}: {
  orderId: string;
  hasEmail: boolean;
  hasPhone: boolean;
  reelReady: boolean;
  connectorEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleDeliver = useCallback(() => {
    // Feature 3a: zustellbar, sobald E-Mail ODER Telefonnummer hinterlegt ist
    // (E-Mail bevorzugt, sonst SMS). Ohne beides bleibt nur der QR-Pfad.
    const canDeliver = hasEmail || hasPhone;
    // Bestätigungsdialog. Bei aktivem Connector führt die Safe-Mode-Rückfrage,
    // sonst die normale Bestätigung; darunter die bewussten Warnungen.
    const lines: string[] = [
      connectorEnabled
        ? t(DEFAULT_LOCALE, "deliver.connectorActive")
        : t(DEFAULT_LOCALE, "deliver.confirm"),
    ];
    if (hasEmail) lines.push(t(DEFAULT_LOCALE, "deliver.confirmText"));
    else if (hasPhone) lines.push(t(DEFAULT_LOCALE, "deliver.confirmTextSms"));
    if (!reelReady) lines.push(t(DEFAULT_LOCALE, "deliver.reelNotReady"));
    if (!canDeliver) lines.push(t(DEFAULT_LOCALE, "deliver.noContact"));
    if (!window.confirm(lines.join("\n\n"))) return;

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const res = await postDeliver(orderId);
        if (!res.ok) {
          let code = "";
          try {
            const body = (await res.json()) as { error?: unknown };
            if (typeof body.error === "string") code = body.error;
          } catch {
            // kein/ungültiger Body → generischer Fehler
          }
          const detail = code ? `${res.status} ${code}` : String(res.status);
          setNotice(`${t(DEFAULT_LOCALE, "deliver.error")} (${detail})`);
          setBusy(false);
          return;
        }
        // Sende-Ergebnis einmalig melden (nach dem Refresh ist der Button weg —
        // die Auslieferung gilt in jedem Fall als erfolgt). Der Operator sieht
        // den Kanal (E-Mail/SMS) bzw. den Fehlergrund.
        const body = (await res.json()) as {
          delivery?: { channel?: string; ok?: boolean; error?: string };
        };
        const d = body.delivery;
        if (d?.ok && d.channel === "email") {
          window.alert(t(DEFAULT_LOCALE, "deliver.sentEmail"));
        } else if (d?.ok && d.channel === "sms") {
          window.alert(t(DEFAULT_LOCALE, "deliver.sentSms"));
        } else if (d?.channel === "none") {
          window.alert(t(DEFAULT_LOCALE, "deliver.noContactSent"));
        } else if (d) {
          window.alert(
            t(DEFAULT_LOCALE, "deliver.sendFailed", { reason: d.error ?? "" }),
          );
        }
        router.refresh(); // Server rendert die Seite im Ausgeliefert-Modus neu
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setNotice(t(DEFAULT_LOCALE, "deliver.timeout"));
        } else {
          console.error("deliver: request failed", error);
          setNotice(t(DEFAULT_LOCALE, "deliver.error"));
        }
        setBusy(false);
      }
    })();
  }, [hasEmail, hasPhone, reelReady, connectorEnabled, orderId, router]);

  return (
    // Grid-Zelle der Aktionszone (rechts unten bei `generated`, neben
    // „Bearbeiten") — vollbreit in der Zelle, normale Höhe (kein capture-btn).
    <div>
      <button
        type="button"
        className={connectorEnabled ? "btn-gold" : "btn-dark"}
        onClick={handleDeliver}
        disabled={busy}
        style={{
          width: "100%",
          opacity: busy ? 0.6 : 1,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy
          ? t(DEFAULT_LOCALE, "deliver.delivering")
          : t(DEFAULT_LOCALE, "deliver.button")}
      </button>

      {notice ? <NoticeBox text={notice} /> : null}
    </div>
  );
}
