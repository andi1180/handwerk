"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import {
  DEFAULT_WEBSITE_CATEGORY,
  WEBSITE_CATEGORIES,
  WEBSITE_CLOTHING_TYPES,
  isPositiveNumber,
  isWebsiteCategory,
  isWebsiteClothingType,
  parseNumericInput,
} from "@/lib/orders/website";

/**
 * Website-Veröffentlichung auf der Auftrags-Detailseite (Migration 0015).
 *
 * ⚠️ VORBEREITENDER BAUSTEIN — KEINE ANBINDUNG: Speichern schreibt
 *    ausschließlich in Handwerks eigene DB. Kein API-Call an die Website, kein
 *    Webhook, kein Versand von Fotos/Videos an eine externe Stelle.
 *
 * Verhalten:
 *  · AUS (Standard) — nur der Schalter. Keine Felder, keine Pflicht.
 *  · EIN (noch nicht gespeichert) — die vier Angaben erscheinen und sind
 *    Pflicht; „Abbrechen" nimmt den Schalter zurück, ohne etwas zu speichern.
 *    Erst „Speichern" macht die Anzeige verbindlich (Hinweis steht dabei).
 *  · GESPEICHERT SICHTBAR — der Schalter ist weg und durch einen
 *    nicht-interaktiven Status ersetzt (Einbahnstraße, Server erzwingt es mit
 *    400 `website_locked`). Die VIER WERTE bleiben ausdrücklich EDITIERBAR,
 *    damit sich z. B. ein Preis nachträglich korrigieren lässt.
 *
 * `div + onClick` / `<button type="button">`, KEIN `<form>`. Die
 * Client-Validierung spiegelt die Server-Validierung (`lib/orders/website.ts`
 * ist für beide dieselbe Quelle).
 *
 * ISOLATION: keine `business_id` im Body — der Route Handler leitet sie aus der
 * Session/Order ab und prüft die Order über RLS.
 */
export function WebsitePublication({
  orderId,
  initialVisible,
  initialCategory,
  initialClothingType,
  initialWorkHours,
  initialPrice,
}: {
  orderId: string;
  initialVisible: boolean;
  initialCategory: string | null;
  initialClothingType: string | null;
  initialWorkHours: number | null;
  initialPrice: number | null;
}) {
  const router = useRouter();

  /** Gespeicherter Zustand — NUR er entscheidet über die Sperre. */
  const [savedVisible, setSavedVisible] = useState(initialVisible);
  /** Zustand des Schalters im Entwurf (vor dem Speichern). */
  const [draftVisible, setDraftVisible] = useState(initialVisible);

  const [category, setCategory] = useState<string>(
    isWebsiteCategory(initialCategory)
      ? initialCategory
      : DEFAULT_WEBSITE_CATEGORY,
  );
  const [clothingType, setClothingType] = useState<string>(
    isWebsiteClothingType(initialClothingType) ? initialClothingType : "",
  );
  // Zahlen als String halten: erlaubt leere und halb getippte Eingaben.
  const [workHours, setWorkHours] = useState(
    initialWorkHours === null ? "" : String(initialWorkHours),
  );
  const [price, setPrice] = useState(
    initialPrice === null ? "" : String(initialPrice),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  /** Einmal gespeichert sichtbar ⇒ Schalter dauerhaft gesperrt. */
  const locked = savedVisible;
  /** Felder zeigen, sobald der Schalter (Entwurf oder gespeichert) an ist. */
  const showFields = locked || draftVisible;

  /** Unsaved-Entwurf: Schalter an, aber noch nicht gespeichert. */
  const isPendingActivation = draftVisible && !savedVisible;

  const clear = useCallback(() => {
    setError(null);
    setSavedNotice(false);
  }, []);

  const toggle = useCallback(() => {
    if (locked || busy) return; // gesperrt: keine Interaktion.
    clear();
    setDraftVisible((v) => !v);
  }, [busy, clear, locked]);

  /** Abbrechen im Entwurf: Schalter zurück auf aus, nichts gespeichert. */
  const cancel = useCallback(() => {
    if (busy) return;
    clear();
    setDraftVisible(false);
  }, [busy, clear]);

  const save = useCallback(() => {
    if (busy) return;
    clear();

    // Client-Validierung = Server-Validierung (geteilte Guards).
    if (!isWebsiteCategory(category)) {
      setError(t(DEFAULT_LOCALE, "website.errCategory"));
      return;
    }
    if (!isWebsiteClothingType(clothingType)) {
      setError(t(DEFAULT_LOCALE, "website.errClothingType"));
      return;
    }
    const hours = parseNumericInput(workHours);
    if (!isPositiveNumber(hours)) {
      setError(t(DEFAULT_LOCALE, "website.errWorkHours"));
      return;
    }
    const parsedPrice = parseNumericInput(price);
    if (!isPositiveNumber(parsedPrice)) {
      setError(t(DEFAULT_LOCALE, "website.errPrice"));
      return;
    }

    setBusy(true);
    void (async () => {
      try {
        const res = await fetch(`/api/portal/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            website_visible: true,
            website_category: category,
            website_clothing_type: clothingType,
            website_work_hours: hours,
            website_price: parsedPrice,
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
          setError(errorMessage(code));
          setBusy(false);
          return;
        }
        const data = (await res.json()) as {
          website_visible: boolean;
          website_category: string | null;
          website_clothing_type: string | null;
          website_work_hours: number | null;
          website_price: number | null;
        };
        // Server-Wahrheit übernehmen (macht die Sperre wirksam).
        setSavedVisible(data.website_visible);
        setDraftVisible(data.website_visible);
        if (isWebsiteCategory(data.website_category)) {
          setCategory(data.website_category);
        }
        if (isWebsiteClothingType(data.website_clothing_type)) {
          setClothingType(data.website_clothing_type);
        }
        if (data.website_work_hours !== null) {
          setWorkHours(String(data.website_work_hours));
        }
        if (data.website_price !== null) {
          setPrice(String(data.website_price));
        }
        setSavedNotice(true);
        setBusy(false);
        router.refresh();
      } catch (err) {
        console.error("website: update failed", err);
        setError(t(DEFAULT_LOCALE, "website.saveError"));
        setBusy(false);
      }
    })();
  }, [busy, category, clear, clothingType, orderId, price, router, workHours]);

  const categoryOptions = useMemo(
    () => WEBSITE_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
    [],
  );
  const clothingOptions = useMemo(
    () => WEBSITE_CLOTHING_TYPES.map((c) => ({ value: c.value, label: c.label })),
    [],
  );

  return (
    <section className="card" style={cardStyle}>
      <h2 style={titleStyle}>{t(DEFAULT_LOCALE, "website.sectionTitle")}</h2>

      {locked ? (
        /* Gespeichert sichtbar: nicht-interaktiver Status statt Schalter. */
        <div style={lockedBoxStyle}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            ✓ {t(DEFAULT_LOCALE, "website.lockedStatus")}
          </span>
          <span style={hintStyle}>{t(DEFAULT_LOCALE, "website.lockedHint")}</span>
        </div>
      ) : (
        /* Schalter (div + onClick, role="switch") — Standard: aus. */
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {t(DEFAULT_LOCALE, "website.toggle")}
          </span>
          <div
            role="switch"
            tabIndex={0}
            aria-checked={draftVisible}
            aria-label={t(DEFAULT_LOCALE, "website.toggle")}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
              }
            }}
            style={{
              width: 46,
              height: 26,
              flexShrink: 0,
              padding: 3,
              borderRadius: 999,
              cursor: "pointer",
              background: draftVisible ? "var(--gold)" : "var(--surface-2)",
              border: "1px solid var(--border)",
              transition: "background 0.15s ease",
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#FFFFFF",
                transform: draftVisible ? "translateX(20px)" : "translateX(0)",
                transition: "transform 0.15s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* AUS ⇒ hier ist Schluss: keine Felder, keine Pflicht, kein Hinweis. */}
      {showFields ? (
        <>
          {/* „Website-Kategorie" ausgeschrieben + Hinweis: NICHT die
              Vorher/Nachher/Prozess-Einteilung der Bilder (order_media.category). */}
          <SelectField
            label={t(DEFAULT_LOCALE, "website.category")}
            hint={t(DEFAULT_LOCALE, "website.categoryHint")}
            value={category}
            options={categoryOptions}
            disabled={busy}
            onChange={(v) => {
              clear();
              setCategory(v);
            }}
          />

          <SelectField
            label={t(DEFAULT_LOCALE, "website.clothingType")}
            value={clothingType}
            options={clothingOptions}
            placeholder="—"
            disabled={busy}
            onChange={(v) => {
              clear();
              setClothingType(v);
            }}
          />

          <NumberField
            label={t(DEFAULT_LOCALE, "website.workHours")}
            value={workHours}
            step="0.5"
            disabled={busy}
            onChange={(v) => {
              clear();
              setWorkHours(v);
            }}
          />

          <NumberField
            label={t(DEFAULT_LOCALE, "website.price")}
            value={price}
            step="0.01"
            disabled={busy}
            onChange={(v) => {
              clear();
              setPrice(v);
            }}
          />

          <span style={hintStyle}>{t(DEFAULT_LOCALE, "website.required")}</span>

          {/* Sperr-Warnung nur VOR dem Speichern — danach steht der Status oben. */}
          {isPendingActivation ? (
            <p style={warnStyle}>⚠ {t(DEFAULT_LOCALE, "website.lockWarning")}</p>
          ) : null}

          {/* Ehrlichkeit über den Umfang: nichts verlässt diese Datenbank. */}
          <span style={hintStyle}>
            {t(DEFAULT_LOCALE, "website.notTransferred")}
          </span>

          {error ? <p style={errorStyle}>{error}</p> : null}
          {savedNotice && !error ? (
            <p style={okStyle}>{t(DEFAULT_LOCALE, "website.saved")}</p>
          ) : null}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn-dark"
              onClick={save}
              disabled={busy}
              style={{
                opacity: busy ? 0.6 : 1,
                cursor: busy ? "default" : "pointer",
              }}
            >
              {busy
                ? t(DEFAULT_LOCALE, "website.saving")
                : t(DEFAULT_LOCALE, "website.save")}
            </button>
            {/* Abbrechen nur im noch nicht gespeicherten Entwurf — nach der
                Sperre gibt es kein Zurück auf „aus". */}
            {isPendingActivation ? (
              <button
                type="button"
                className="btn-outline"
                onClick={cancel}
                disabled={busy}
              >
                {t(DEFAULT_LOCALE, "website.cancel")}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Übersetzt einen Server-Fehlercode in eine Meldung. */
function errorMessage(code: string): string {
  switch (code) {
    case "invalid_website_category":
      return t(DEFAULT_LOCALE, "website.errCategory");
    case "invalid_website_clothing_type":
      return t(DEFAULT_LOCALE, "website.errClothingType");
    case "invalid_website_work_hours":
      return t(DEFAULT_LOCALE, "website.errWorkHours");
    case "invalid_website_price":
      return t(DEFAULT_LOCALE, "website.errPrice");
    case "website_locked":
      return t(DEFAULT_LOCALE, "website.errLocked");
    default:
      return t(DEFAULT_LOCALE, "website.saveError");
  }
}

/** Auswahlfeld (Muster wie `SelectField` der Settings-Form). */
function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label style={labelStyle}>
      <span style={captionStyle}>{label}</span>
      <select
        className="form-input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder !== undefined ? (
          <option value="">{placeholder}</option>
        ) : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint ? <span style={hintStyle}>{hint}</span> : null}
    </label>
  );
}

/** Numerisches Eingabefeld (String-State ⇒ leere Eingabe möglich). */
function NumberField({
  label,
  value,
  onChange,
  step,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step: string;
  disabled?: boolean;
}) {
  return (
    <label style={labelStyle}>
      <span style={captionStyle}>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        className="form-input"
        min="0"
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  marginTop: 32,
};
const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
};
const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const captionStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
};
const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
};
const lockedBoxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "10px 12px",
  background: "var(--gold-light)",
  border: "1px solid var(--gold-border)",
  borderRadius: "var(--radius)",
};
const warnStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-primary)",
};
const errorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "#B23B3B",
};
const okStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "var(--green-text)",
};
