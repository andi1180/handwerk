"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { isEmailFormat } from "@/lib/settings/options";

/**
 * Kundenkontakt (E-Mail + Telefon) auf der Auftrags-Detailseite — Anzeige mit
 * Inline-Editier-Modus. `div + onClick`, KEIN `<form>`.
 *
 * Anzeige-Modus: belegte Felder als Zeilen (leer ⇒ Zeile nicht zeigen), darunter
 * ein dezenter „Kontakt bearbeiten"-Button. Der Button ist IMMER sichtbar — auch
 * wenn beide Felder leer sind — damit eine fehlende Nummer/Mail nachgetragen
 * werden kann.
 *
 * Editier-Modus: editierbare E-Mail-/Telefon-Felder (auch wenn leer) + Speichern/
 * Abbrechen. Speichern ⇒ `PATCH /api/portal/orders/[id]`; bei Erfolg wird die
 * Anzeige aktualisiert und `router.refresh()` gerufen, damit die server-gerenderte
 * Seite (z. B. die `hasEmail`-Warnung des Ausliefern-Buttons) konsistent bleibt.
 *
 * ISOLATION: keine `business_id` im Body — der Route Handler leitet sie aus der
 * Session/Order ab und prüft die Order über RLS.
 */
export function ContactEditor({
  orderId,
  initialEmail,
  initialPhone,
}: {
  orderId: string;
  initialEmail: string | null;
  initialPhone: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [editing, setEditing] = useState(false);
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = useCallback(() => {
    setDraftEmail(email ?? "");
    setDraftPhone(phone ?? "");
    setError(null);
    setEditing(true);
  }, [email, phone]);

  const cancel = useCallback(() => {
    setEditing(false);
    setError(null);
  }, []);

  const save = useCallback(() => {
    if (busy) return;
    const trimmedEmail = draftEmail.trim();
    // Client-Validierung = Server-Validierung: gesetzt ⇒ Format prüfen, leer ok.
    if (trimmedEmail.length > 0 && !isEmailFormat(trimmedEmail)) {
      setError(t(DEFAULT_LOCALE, "contact.invalidEmail"));
      return;
    }

    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/portal/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customer_email: draftEmail,
            customer_phone: draftPhone,
          }),
        });
        if (!res.ok) {
          let code = "";
          try {
            const body = (await res.json()) as { error?: unknown };
            if (typeof body.error === "string") code = body.error;
          } catch {
            // kein/ungültiger Body → generischer Fehler
          }
          setError(
            code === "invalid_email"
              ? t(DEFAULT_LOCALE, "contact.invalidEmail")
              : t(DEFAULT_LOCALE, "contact.saveError"),
          );
          setBusy(false);
          return;
        }
        const data = (await res.json()) as {
          customer_email: string | null;
          customer_phone: string | null;
        };
        setEmail(data.customer_email);
        setPhone(data.customer_phone);
        setEditing(false);
        setBusy(false);
        // Server-Tree neu rendern (hasEmail-Warnung des Ausliefern-Buttons etc.).
        router.refresh();
      } catch (err) {
        console.error("contact: update failed", err);
        setError(t(DEFAULT_LOCALE, "contact.saveError"));
        setBusy(false);
      }
    })();
  }, [busy, draftEmail, draftPhone, orderId, router]);

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={fieldStyle}>
          <span style={captionStyle}>{t(DEFAULT_LOCALE, "orders.email")}</span>
          <input
            type="email"
            autoComplete="off"
            className="form-input"
            value={draftEmail}
            onChange={(e) => setDraftEmail(e.target.value)}
          />
        </label>

        <label style={fieldStyle}>
          <span style={captionStyle}>{t(DEFAULT_LOCALE, "orders.phone")}</span>
          <input
            type="tel"
            autoComplete="off"
            className="form-input"
            value={draftPhone}
            onChange={(e) => setDraftPhone(e.target.value)}
          />
        </label>

        {error ? (
          <p style={{ margin: 0, fontSize: 13, color: "#B23B3B" }}>{error}</p>
        ) : null}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className="btn-dark"
            onClick={save}
            disabled={busy}
            style={{ opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
          >
            {busy
              ? t(DEFAULT_LOCALE, "contact.saving")
              : t(DEFAULT_LOCALE, "contact.save")}
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={cancel}
            disabled={busy}
          >
            {t(DEFAULT_LOCALE, "contact.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {email ? (
        <Row label={t(DEFAULT_LOCALE, "orders.email")} value={email} />
      ) : null}
      {phone ? (
        <Row label={t(DEFAULT_LOCALE, "orders.phone")} value={phone} />
      ) : null}
      <button
        type="button"
        onClick={startEdit}
        style={{
          alignSelf: "flex-start",
          background: "none",
          border: "none",
          padding: 0,
          fontSize: 13,
          color: "var(--text-secondary)",
          textDecoration: "underline",
          cursor: "pointer",
        }}
      >
        {t(DEFAULT_LOCALE, "contact.edit")}
      </button>
    </div>
  );
}

/** Stammdaten-Zeile (Label links, Wert rechts) — Optik wie `MetaRow` der Seite. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 14 }}>
      <span style={{ minWidth: 110, flexShrink: 0, color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span style={{ wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const captionStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
};
