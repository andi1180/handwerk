"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { CUSTOMER_VIEW_QUERY } from "@/lib/booklet/customer-view";

/**
 * Auslieferung im Portal (Schritt 9c-1). Zwei kleine Client-Komponenten,
 * `div + onClick`, kein `<form>`:
 *
 *  - `<DeliverButton>` (Status `generated`): prominenter „Booklet ausliefern"-
 *    Button am Seitenende. Bestätigungsdialog mit bewussten Warnungen (Reel noch
 *    nicht fertig / keine E-Mail — KEIN harter Block), dann `POST deliver` →
 *    `router.refresh()`. `emailFailed` ⇒ Hinweis, der Auftrag gilt trotzdem als
 *    ausgeliefert.
 *  - `<DeliveredBanner>` (Status `sent`): Banner „Ausgeliefert am {Datum}" + die
 *    Vorschau bleibt erreichbar (read-only-Modus, keine Edit-Controls).
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

/** Prominenter „Booklet ausliefern"-Button (Status `generated`). */
export function DeliverButton({
  orderId,
  hasEmail,
  reelReady,
}: {
  orderId: string;
  hasEmail: boolean;
  reelReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleDeliver = useCallback(() => {
    // Bestätigungsdialog mit bewussten Warnungen (kein harter Block).
    const lines: string[] = [t(DEFAULT_LOCALE, "deliver.confirm")];
    if (hasEmail) lines.push(t(DEFAULT_LOCALE, "deliver.confirmText"));
    if (!reelReady) lines.push(t(DEFAULT_LOCALE, "deliver.reelNotReady"));
    if (!hasEmail) lines.push(t(DEFAULT_LOCALE, "deliver.noEmail"));
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
        // E-Mail fehlgeschlagen? Einmalig melden (nach dem Refresh ist der
        // Button weg — die Auslieferung gilt trotzdem als erfolgt).
        const body = (await res.json()) as { emailFailed?: unknown };
        if (body.emailFailed === true) {
          window.alert(t(DEFAULT_LOCALE, "deliver.emailFailed"));
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
  }, [hasEmail, reelReady, orderId, router]);

  return (
    <div style={{ marginTop: 24 }}>
      <button
        type="button"
        className="btn-gold capture-btn"
        onClick={handleDeliver}
        disabled={busy}
        style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
      >
        {busy
          ? t(DEFAULT_LOCALE, "deliver.delivering")
          : t(DEFAULT_LOCALE, "deliver.button")}
      </button>

      {notice ? <NoticeBox text={notice} /> : null}
    </div>
  );
}

/** Banner „Ausgeliefert am {Datum}" + Vorschau-Link (Status `sent`). */
export function DeliveredBanner({
  deliveredAt,
  token,
}: {
  deliveredAt: string | null;
  token: string | null;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        className="card"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "var(--green-light)",
          borderColor: "var(--green-border)",
          padding: "14px 16px",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--green-text)",
          }}
        >
          <SentIcon />
          {deliveredAt
            ? t(DEFAULT_LOCALE, "deliver.delivered", { date: deliveredAt })
            : t(DEFAULT_LOCALE, "deliver.deliveredNoDate")}
        </span>
        {token ? (
          <a
            className="btn-outline"
            href={`/b/${token}?${CUSTOMER_VIEW_QUERY}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ flexShrink: 0 }}
          >
            {t(DEFAULT_LOCALE, "generate.openPreview")}
          </a>
        ) : null}
      </div>
    </div>
  );
}

/** Papierflieger fürs Ausgeliefert-Banner. Reine Deko. */
function SentIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}
