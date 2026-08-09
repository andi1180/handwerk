"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import {
  DEFAULT_WEBSITE_CATEGORY,
  WEBSITE_CATEGORIES,
  WEBSITE_CLOTHING_TYPES,
  WEBSITE_TEXT_MIN_LENGTH,
  isPositiveNumber,
  isValidWebsiteText,
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
 *
 *    ⚠️ Ist das Textfeld beim Einschalten LEER, wird sofort ein Entwurf
 *       angefordert (`POST …/website-text`, 0018). Solange die Anfrage läuft,
 *       steht der Hinweis „Text wird erzeugt …“ am Feld und das Feld ist nicht
 *       bearbeitbar — sonst würde die eintreffende Antwort überschreiben, was
 *       gerade jemand tippt. Der Entwurf kommt ins Feld und trägt das
 *       Kennzeichen „KI-Entwurf, ungeprüft“, bis ihn jemand ändert.
 *    ⚠️ KEIN Einwilligungs-Schalter mehr: Sie wird an der Kassa bei jedem Stück
 *       eingeholt und deshalb schon bei der Auftragsanlage gesetzt. Der Server
 *       prüft sie weiterhin (400 `consent_required`) — als stiller Schutz für
 *       Aufträge von VOR dieser Umstellung, nicht als etwas zum Anklicken.
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
  initialText,
  initialKiDraft,
}: {
  orderId: string;
  initialVisible: boolean;
  initialCategory: string | null;
  initialClothingType: string | null;
  initialWorkHours: number | null;
  initialPrice: number | null;
  initialText: string | null;
  initialKiDraft: boolean;
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
  /* „Was wurde gemacht" (0017). Bewusst NICHT aus `item_description`
     vorbefüllt: Ein vorbefülltes Feld wird bestätigt statt geschrieben — und
     genau die Annahmenotiz mit Maßen und Kürzeln soll hier nicht landen. Der
     KI-Entwurf (0018) ist etwas anderes: Er beschreibt bereits die Arbeit und
     ist als Entwurf gekennzeichnet. */
  const [text, setText] = useState(initialText ?? "");

  /* Der Wortlaut des unbearbeiteten KI-Entwurfs, oder `null`, wenn der aktuelle
     Text keiner ist. Das Kennzeichen unten hängt am VERGLEICH mit diesem Stand
     — genau wie die Ableitung auf dem Server. Sobald jemand ein Zeichen ändert,
     stimmt der Vergleich nicht mehr und das Kennzeichen verschwindet. */
  const [draftRef, setDraftRef] = useState<string | null>(
    initialKiDraft ? (initialText ?? "") : null,
  );
  /** Läuft gerade eine Entwurfs-Anfrage? Sperrt das Textfeld. */
  const [generating, setGenerating] = useState(false);
  /** Fehler der Entwurfs-Erzeugung — steht am Feld, nicht bei den Angaben. */
  const [generationError, setGenerationError] = useState<string | null>(null);

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
    // Ein gescheiterter Entwurf ist erledigt, sobald jemand selbst tippt.
    setGenerationError(null);
  }, []);

  /**
   * Fordert einen Textentwurf an (0018) und setzt ihn ins Feld.
   *
   * Der Server erzeugt NUR, wenn dort noch kein Text steht — steht einer, gibt
   * er ihn unverändert zurück. Das Kennzeichen kommt ebenfalls von dort; der
   * Client behauptet es nicht.
   */
  const requestDraft = useCallback(async () => {
    setGenerating(true);
    setGenerationError(null);
    try {
      const res = await fetch(`/api/portal/orders/${orderId}/website-text`, {
        method: "POST",
      });
      if (!res.ok) {
        setGenerationError(t(DEFAULT_LOCALE, "website.errTextGeneration"));
        return;
      }
      const data = (await res.json()) as { text: string; ki_entwurf: boolean };
      setText(data.text);
      setDraftRef(data.ki_entwurf ? data.text : null);
    } catch (err) {
      console.error("website: text draft failed", err);
      setGenerationError(t(DEFAULT_LOCALE, "website.errTextGeneration"));
    } finally {
      setGenerating(false);
    }
  }, [orderId]);

  const toggle = useCallback(() => {
    if (locked || busy || generating) return; // gesperrt: keine Interaktion.
    clear();
    const next = !draftVisible;
    setDraftVisible(next);
    /* Einschalten mit leerem Feld ⇒ Entwurf sofort anfordern, damit ihn jemand
       ansehen und korrigieren kann, BEVOR gespeichert wird. Steht schon ein
       Text da, passiert nichts — weder hier noch auf dem Server. */
    if (next && text.trim().length === 0) {
      void requestDraft();
    }
  }, [busy, clear, draftVisible, generating, locked, requestDraft, text]);

  /** Abbrechen im Entwurf: Schalter zurück auf aus, nichts gespeichert. */
  const cancel = useCallback(() => {
    if (busy || generating) return;
    clear();
    setDraftVisible(false);
  }, [busy, clear, generating]);

  const save = useCallback(() => {
    if (busy || generating) return;
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
    if (!isValidWebsiteText(text)) {
      setError(t(DEFAULT_LOCALE, "website.errText"));
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
            website_text: text,
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
          website_text: string | null;
          website_text_ki_entwurf: boolean;
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
        // Getrimmte Server-Fassung übernehmen — sonst stünde im Feld eine
        // andere Zeichenkette als in der Datenbank.
        if (data.website_text !== null) {
          setText(data.website_text);
        }
        /* Das Kennzeichen leitet der Server ab (er hat den gespeicherten Stand
           zum Vergleich). Der Client übernimmt nur, was zurückkommt — auch den
           Fall, dass beim Speichern erzeugt wurde, weil das Feld leer war. */
        setDraftRef(
          data.website_text_ki_entwurf ? (data.website_text ?? "") : null,
        );
        setSavedNotice(true);
        setBusy(false);
        router.refresh();
      } catch (err) {
        console.error("website: update failed", err);
        setError(t(DEFAULT_LOCALE, "website.saveError"));
        setBusy(false);
      }
    })();
  }, [
    busy,
    category,
    clear,
    clothingType,
    generating,
    orderId,
    price,
    router,
    text,
    workHours,
  ]);

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
        <SwitchRow
          label={t(DEFAULT_LOCALE, "website.toggle")}
          checked={draftVisible}
          onToggle={toggle}
        />
      )}

      {/* AUS ⇒ hier ist Schluss: keine Felder, keine Pflicht, kein Hinweis. */}
      {showFields ? (
        <>
          {/* Hier stand der Einwilligungs-Schalter. Entfallen: Die Einwilligung
              wird an der Kassa bei JEDEM Stück eingeholt und deshalb schon bei
              der Auftragsanlage gesetzt (Webhook wie manueller Weg) — ein Klick,
              dessen Antwort immer dieselbe ist, ist keine Entscheidung.

              Die Server-Prüfung bleibt als stiller Schutz: Fehlt die
              Einwilligung doch einmal (etwa bei einem Auftrag von VOR dieser
              Umstellung), verweigert der Server das Veröffentlichen mit 400
              `consent_required` — sichtbar als Fehlermeldung unten. Nachtragen
              ist dann ein Eingriff per SQL/API, kein Klick. */}

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

          {/* „Was wurde gemacht" — die Textquelle fürs öffentliche Archiv.
              Steht bewusst UNTER den vier Zahlen-/Auswahlfeldern: die sind in
              Sekunden erledigt, dieses will einen Moment Nachdenken.

              Während der Entwurf erzeugt wird, ist das Feld gesperrt — sonst
              überschriebe die eintreffende Antwort, was gerade jemand tippt. */}
          <TextField
            label={t(DEFAULT_LOCALE, "website.text")}
            hint={t(DEFAULT_LOCALE, "website.textHint")}
            value={text}
            minLength={WEBSITE_TEXT_MIN_LENGTH}
            disabled={busy || generating}
            generating={generating}
            badge={
              draftRef !== null && text === draftRef
                ? t(DEFAULT_LOCALE, "website.kiDraftBadge")
                : null
            }
            error={generationError}
            onRetry={generationError && !busy ? requestDraft : undefined}
            onChange={(v) => {
              clear();
              setText(v);
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
            {/* Während der Entwurf erzeugt wird, ist Speichern gesperrt: Der
                Text, um den es geht, ist noch unterwegs. */}
            <button
              type="button"
              className="btn-dark"
              onClick={save}
              disabled={busy || generating}
              style={{
                opacity: busy || generating ? 0.6 : 1,
                cursor: busy || generating ? "default" : "pointer",
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
                disabled={busy || generating}
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

/**
 * Schalter-Zeile (Beschriftung links, `role="switch"` rechts).
 *
 * `div + onClick` + Enter/Space, KEIN `<input type="checkbox">`
 * (Projekt-Konvention, wie der Settings-Toggle).
 */
function SwitchRow({
  label,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      <div
        role="switch"
        tabIndex={disabled ? -1 : 0}
        aria-checked={checked}
        aria-label={label}
        onClick={disabled ? undefined : onToggle}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        style={{
          width: 46,
          height: 26,
          flexShrink: 0,
          padding: 3,
          borderRadius: 999,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
          background: checked ? "var(--gold)" : "var(--surface-2)",
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
            transform: checked ? "translateX(20px)" : "translateX(0)",
            transition: "transform 0.15s ease",
          }}
        />
      </div>
    </div>
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
    case "invalid_website_text":
      return t(DEFAULT_LOCALE, "website.errText");
    // Auffangnetz-Erzeugung beim Umlegen ist gescheitert (0018). Gespeichert
    // wurde nichts — auch kein leerer Text.
    case "text_generation_failed":
      return t(DEFAULT_LOCALE, "website.errTextGeneration");
    /* Kein Schalter mehr, aber der Fall bleibt möglich: Aufträge von VOR der
       automatischen Einwilligung tragen `consent_given = false`. Nachtragen ist
       dann ein Eingriff per SQL/API. */
    case "consent_required":
      return t(DEFAULT_LOCALE, "website.errConsent");
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

/**
 * Mehrzeiliges Textfeld für „Was wurde gemacht" (Migration 0017).
 *
 * Der Zähler erscheint NUR, solange der Text zu kurz ist. Dauerhaft sichtbar
 * würde er beim Schreiben mitgezählt werden, statt dass jemand schreibt; ganz
 * ohne ihn wäre „mindestens 80 Zeichen" eine Bedingung, deren Erfüllung man
 * raten muss. Gezählt wird der GETRIMMTE Text — genau der wird geprüft.
 *
 * Dazu die drei Zustände der Entwurfs-Erzeugung (0018), alle AM FELD und nicht
 * bei den übrigen Angaben — hier passiert es, hier muss es stehen:
 *  · `generating` — „Text wird erzeugt …" statt Zähler, Feld gesperrt.
 *  · `badge`      — „KI-Entwurf, ungeprüft", solange niemand ihn geändert hat.
 *  · `error`      — Erzeugung gescheitert, mit Weg zurück (`onRetry`); ohne den
 *                   bliebe nur, den Text von Hand zu schreiben.
 */
function TextField({
  label,
  value,
  onChange,
  hint,
  minLength,
  disabled,
  generating,
  badge,
  error,
  onRetry,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  minLength: number;
  disabled?: boolean;
  generating?: boolean;
  badge?: string | null;
  error?: string | null;
  onRetry?: () => void;
}) {
  const laenge = value.trim().length;
  const fehlend = minLength - laenge;

  return (
    <label style={labelStyle}>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={captionStyle}>{label}</span>
        {badge ? <span style={draftBadgeStyle}>{badge}</span> : null}
      </span>
      <textarea
        className="form-input"
        rows={4}
        value={value}
        disabled={disabled}
        style={{
          resize: "vertical",
          minHeight: 96,
          lineHeight: 1.5,
          opacity: generating ? 0.6 : 1,
        }}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span style={hintStyle}>{hint}</span> : null}
      {generating ? (
        <span style={{ ...hintStyle, fontWeight: 600 }}>
          {t(DEFAULT_LOCALE, "website.textGenerating")}
        </span>
      ) : null}
      {error ? (
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#B23B3B" }}>{error}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              style={retryButtonStyle}
            >
              {t(DEFAULT_LOCALE, "website.textRetry")}
            </button>
          ) : null}
        </span>
      ) : null}
      {/* Zähler pausiert während der Erzeugung: Ein leeres, gesperrtes Feld mit
          „Noch 80 Zeichen" wäre eine Aufforderung, der man nicht folgen kann. */}
      {!generating && fehlend > 0 ? (
        <span style={hintStyle}>
          {t(DEFAULT_LOCALE, "website.textCounter", {
            fehlend,
            laenge,
            min: minLength,
          })}
        </span>
      ) : null}
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
/** Kennzeichen „KI-Entwurf, ungeprüft" neben der Feldbeschriftung. */
const draftBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--amber-light)",
  border: "1px solid var(--amber-border)",
  color: "var(--amber-text)",
};
/** „Erneut erzeugen" — klein, direkt neben der Fehlermeldung am Feld. */
const retryButtonStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: "3px 10px",
  borderRadius: 999,
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontFamily: "inherit",
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
