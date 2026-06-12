"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import type { CurrentBusiness } from "@/lib/auth/current-business";
import {
  LOGO_ACCEPT_ATTR,
  LogoPrepareError,
  prepareLogo,
  type PreparedLogo,
} from "@/lib/media/logo";
import {
  BACKGROUND_ACCEPT_ATTR,
  BackgroundPrepareError,
  prepareBackground,
} from "@/lib/media/background";
import {
  CONTENT_LIMITS,
  DELIVERY_MODES,
  FONT_OPTIONS,
  PHOTO_COUNT,
  RETENTION_MONTHS,
  VIDEO_COUNT,
  VIDEO_SECONDS,
  backgroundStoragePath,
  isDeliveryMode,
  isEmailFormat,
  isFontOption,
  isHexColor,
  type BackgroundSlot,
  type DeliveryMode,
  type FontOption,
} from "@/lib/settings/options";

/** Zustand des Speichern-Indikators. */
type SaveState = "idle" | "saving" | "saved" | "error";

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
const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  marginBottom: 20,
};
const groupTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 700,
};

/**
 * Basis-Einstellungen eines Betriebs (Client Component, Schritt 5a).
 * Kein `<form>`-Tag — Speichern über `div + onClick`. ISOLATION: es wird KEINE
 * `business_id` mitgeschickt; der Route Handler leitet sie aus der Session ab.
 * Felder sind in `.card`-Blöcke gruppiert; Client-Validierung deckt sich mit
 * der Server-Validierung (Ranges, Hex, nicht-leerer Name).
 */
export function SettingsForm({
  business,
  logoPreviewUrl,
  introBgPreviewUrl,
  outroBgPreviewUrl,
}: {
  business: CurrentBusiness;
  /** Server-seitig signierte Logo-Vorschau (privater Bucket), sonst null. */
  logoPreviewUrl: string | null;
  /** Server-seitig signierte Intro-Hintergrund-Vorschau, sonst null. */
  introBgPreviewUrl: string | null;
  /** Server-seitig signierte Outro-Hintergrund-Vorschau, sonst null. */
  outroBgPreviewUrl: string | null;
}) {
  const router = useRouter();

  const [name, setName] = useState(business.name);
  const [primaryColor, setPrimaryColor] = useState(business.branding.primary_color);
  const [secondaryColor, setSecondaryColor] = useState(
    business.branding.secondary_color,
  );
  const [font, setFont] = useState<FontOption>(business.branding.font);
  const [logoPerPage, setLogoPerPage] = useState(business.branding.logo_per_page);
  const [videoMaxSeconds, setVideoMaxSeconds] = useState(
    business.settings.video_max_seconds,
  );
  const [photoMaxCount, setPhotoMaxCount] = useState(
    business.settings.photo_max_count,
  );
  const [videoMaxCount, setVideoMaxCount] = useState(
    business.settings.video_max_count,
  );
  const [igHandle, setIgHandle] = useState(business.settings.ig_handle ?? "");
  const [googleReviewUrl, setGoogleReviewUrl] = useState(
    business.settings.google_review_url ?? "",
  );
  const [websiteUrl, setWebsiteUrl] = useState(business.settings.website_url ?? "");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(
    business.settings.delivery_mode,
  );
  const [retentionMonths, setRetentionMonths] = useState(business.retention_months);
  const [introTagline, setIntroTagline] = useState(
    business.settings.intro_tagline ?? "",
  );
  const [outroMessage, setOutroMessage] = useState(
    business.settings.outro_message ?? "",
  );
  // Kontakt-E-Mail (für Antworten der Kunden, reply-to im Versand). Beim ersten
  // Anzeigen mit der Login-E-Mail (business_email) vorbelegt, falls noch nicht
  // gesetzt — so greift der reply-to ab dem ersten Speichern (Block B, Punkt 6).
  const [contactEmail, setContactEmail] = useState(
    business.settings.contact_email ?? business.business_email,
  );
  const [contactPhone, setContactPhone] = useState(
    business.settings.contact_phone ?? "",
  );
  const [aiContext, setAiContext] = useState(business.settings.ai_context ?? "");
  // roapp-Connector aktiviert (Block B, Punkt 3) — Default AN (normalisiert).
  const [connectorRoapp, setConnectorRoapp] = useState(
    business.settings.connector_roapp_enabled,
  );

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /** Jede Änderung verwirft eine evtl. „Gespeichert"-Meldung. */
  const markDirty = () => {
    if (saveState !== "idle") {
      setSaveState("idle");
      setErrorMsg(null);
    }
  };

  const fail = (message: string) => {
    setSaveState("error");
    setErrorMsg(message);
  };

  const handleSave = async () => {
    if (saveState === "saving") return;

    if (name.trim().length === 0) {
      fail(t(DEFAULT_LOCALE, "settings.errName"));
      return;
    }
    if (!isHexColor(primaryColor) || !isHexColor(secondaryColor)) {
      fail(t(DEFAULT_LOCALE, "settings.errColor"));
      return;
    }
    if (
      !Number.isInteger(videoMaxSeconds) ||
      videoMaxSeconds < VIDEO_SECONDS.min ||
      videoMaxSeconds > VIDEO_SECONDS.max
    ) {
      fail(
        t(DEFAULT_LOCALE, "settings.errVideo", {
          min: VIDEO_SECONDS.min,
          max: VIDEO_SECONDS.max,
        }),
      );
      return;
    }
    if (
      !Number.isInteger(retentionMonths) ||
      retentionMonths < RETENTION_MONTHS.min ||
      retentionMonths > RETENTION_MONTHS.max
    ) {
      fail(
        t(DEFAULT_LOCALE, "settings.errRetention", {
          min: RETENTION_MONTHS.min,
          max: RETENTION_MONTHS.max,
        }),
      );
      return;
    }
    if (
      !Number.isInteger(photoMaxCount) ||
      photoMaxCount < PHOTO_COUNT.min ||
      photoMaxCount > PHOTO_COUNT.max
    ) {
      fail(
        t(DEFAULT_LOCALE, "settings.errPhotoCount", {
          min: PHOTO_COUNT.min,
          max: PHOTO_COUNT.max,
        }),
      );
      return;
    }
    if (
      !Number.isInteger(videoMaxCount) ||
      videoMaxCount < VIDEO_COUNT.min ||
      videoMaxCount > VIDEO_COUNT.max
    ) {
      fail(
        t(DEFAULT_LOCALE, "settings.errVideoCount", {
          min: VIDEO_COUNT.min,
          max: VIDEO_COUNT.max,
        }),
      );
      return;
    }
    if (
      introTagline.trim().length > CONTENT_LIMITS.introTagline ||
      outroMessage.trim().length > CONTENT_LIMITS.outroMessage ||
      contactPhone.trim().length > CONTENT_LIMITS.contactPhone
    ) {
      fail(t(DEFAULT_LOCALE, "settings.content.tooLong"));
      return;
    }
    if (contactEmail.trim().length > 0 && !isEmailFormat(contactEmail.trim())) {
      fail(t(DEFAULT_LOCALE, "settings.content.emailInvalid"));
      return;
    }
    if (aiContext.trim().length > CONTENT_LIMITS.aiContext) {
      fail(t(DEFAULT_LOCALE, "settings.aiContext.tooLong"));
      return;
    }

    setSaveState("saving");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/portal/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          font,
          logo_per_page: logoPerPage,
          video_max_seconds: videoMaxSeconds,
          photo_max_count: photoMaxCount,
          video_max_count: videoMaxCount,
          ig_handle: igHandle,
          google_review_url: googleReviewUrl,
          website_url: websiteUrl,
          delivery_mode: deliveryMode,
          retention_months: retentionMonths,
          intro_tagline: introTagline,
          outro_message: outroMessage,
          contact_email: contactEmail,
          contact_phone: contactPhone,
          ai_context: aiContext,
          connector_roapp_enabled: connectorRoapp,
        }),
      });

      if (!res.ok) {
        fail(t(DEFAULT_LOCALE, "settings.error"));
        return;
      }

      setSaveState("saved");
      router.refresh();
    } catch {
      fail(t(DEFAULT_LOCALE, "settings.error"));
    }
  };

  const saving = saveState === "saving";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 700 }}>
        {t(DEFAULT_LOCALE, "settings.title")}
      </h1>

      {/* Betrieb */}
      <div className="card" style={cardStyle}>
        <h2 style={groupTitleStyle}>{t(DEFAULT_LOCALE, "settings.groupBusiness")}</h2>
        <TextField
          label={t(DEFAULT_LOCALE, "settings.name")}
          value={name}
          onChange={(v) => {
            markDirty();
            setName(v);
          }}
        />
        {/* Kontakt-E-Mail (reply-to im Versand). Vorbelegt mit der Login-E-Mail,
            darf aber abweichen — Hinweis macht das klar (Block B, Punkt 6). */}
        <TextField
          label={t(DEFAULT_LOCALE, "settings.contactEmail")}
          type="email"
          value={contactEmail}
          placeholder="kontakt@meinbetrieb.de"
          hint={t(DEFAULT_LOCALE, "settings.contactEmailHint")}
          onChange={(v) => {
            markDirty();
            setContactEmail(v);
          }}
        />
      </div>

      {/* Branding */}
      <div className="card" style={cardStyle}>
        <h2 style={groupTitleStyle}>{t(DEFAULT_LOCALE, "settings.groupBranding")}</h2>
        <ColorField
          label={t(DEFAULT_LOCALE, "settings.primaryColor")}
          value={primaryColor}
          onChange={(v) => {
            markDirty();
            setPrimaryColor(v);
          }}
        />
        <ColorField
          label={t(DEFAULT_LOCALE, "settings.secondaryColor")}
          value={secondaryColor}
          onChange={(v) => {
            markDirty();
            setSecondaryColor(v);
          }}
        />
        <SelectField
          label={t(DEFAULT_LOCALE, "settings.font")}
          value={font}
          onChange={(v) => {
            if (isFontOption(v)) {
              markDirty();
              setFont(v);
            }
          }}
          options={FONT_OPTIONS.map((f) => ({ value: f, label: f }))}
        />
        <Toggle
          label={t(DEFAULT_LOCALE, "settings.logoPerPage")}
          checked={logoPerPage}
          onChange={(v) => {
            markDirty();
            setLogoPerPage(v);
          }}
        />
      </div>

      {/* Logo (eigene Speicher-/Lösch-Logik, unabhängig vom „Speichern" oben) */}
      <div className="card" style={cardStyle}>
        <h2 style={groupTitleStyle}>{t(DEFAULT_LOCALE, "settings.logo.title")}</h2>
        <LogoField businessId={business.id} initialPreviewUrl={logoPreviewUrl} />
      </div>

      {/* Hintergründe (Intro/Outro) — je eigene Speicher-/Lösch-Logik wie das Logo */}
      <div className="card" style={cardStyle}>
        <h2 style={groupTitleStyle}>
          {t(DEFAULT_LOCALE, "settings.background.sectionTitle")}
        </h2>
        <ImageUploadField
          businessId={business.id}
          slot="intro"
          label={t(DEFAULT_LOCALE, "settings.background.intro")}
          initialPreviewUrl={introBgPreviewUrl}
          previewAspect={9 / 16}
          previewFit="cover"
        />
        <ImageUploadField
          businessId={business.id}
          slot="outro"
          label={t(DEFAULT_LOCALE, "settings.background.outro")}
          initialPreviewUrl={outroBgPreviewUrl}
          previewAspect={9 / 16}
          previewFit="cover"
        />
      </div>

      {/* Aufnahme */}
      <div className="card" style={cardStyle}>
        <h2 style={groupTitleStyle}>{t(DEFAULT_LOCALE, "settings.groupCapture")}</h2>
        <RangeNumberField
          label={t(DEFAULT_LOCALE, "settings.videoMaxSeconds")}
          value={videoMaxSeconds}
          min={VIDEO_SECONDS.min}
          max={VIDEO_SECONDS.max}
          onChange={(v) => {
            markDirty();
            setVideoMaxSeconds(v);
          }}
          hint={t(DEFAULT_LOCALE, "settings.videoMaxSecondsHint", {
            default: VIDEO_SECONDS.default,
            max: VIDEO_SECONDS.max,
          })}
        />
        <RangeNumberField
          label={t(DEFAULT_LOCALE, "settings.photoMaxCount")}
          value={photoMaxCount}
          min={PHOTO_COUNT.min}
          max={PHOTO_COUNT.max}
          onChange={(v) => {
            markDirty();
            setPhotoMaxCount(v);
          }}
          hint={t(DEFAULT_LOCALE, "settings.photoMaxCountHint", {
            default: PHOTO_COUNT.default,
            max: PHOTO_COUNT.max,
          })}
        />
        <RangeNumberField
          label={t(DEFAULT_LOCALE, "settings.videoMaxCount")}
          value={videoMaxCount}
          min={VIDEO_COUNT.min}
          max={VIDEO_COUNT.max}
          onChange={(v) => {
            markDirty();
            setVideoMaxCount(v);
          }}
          hint={t(DEFAULT_LOCALE, "settings.videoMaxCountHint", {
            default: VIDEO_COUNT.default,
            max: VIDEO_COUNT.max,
          })}
        />
      </div>

      {/* Online-Präsenz / Links */}
      <div className="card" style={cardStyle}>
        <h2 style={groupTitleStyle}>{t(DEFAULT_LOCALE, "settings.groupLinks")}</h2>
        <TextField
          label={t(DEFAULT_LOCALE, "settings.igHandle")}
          value={igHandle}
          placeholder="@meinbetrieb"
          hint={t(DEFAULT_LOCALE, "settings.igHandleHint")}
          onChange={(v) => {
            markDirty();
            setIgHandle(v);
          }}
        />
        <TextField
          label={t(DEFAULT_LOCALE, "settings.googleReviewUrl")}
          type="url"
          value={googleReviewUrl}
          placeholder="https://"
          onChange={(v) => {
            markDirty();
            setGoogleReviewUrl(v);
          }}
        />
        <TextField
          label={t(DEFAULT_LOCALE, "settings.websiteUrl")}
          type="url"
          value={websiteUrl}
          placeholder="https://"
          onChange={(v) => {
            markDirty();
            setWebsiteUrl(v);
          }}
        />
      </div>

      {/* Booklet-Inhalt (Intro & Outro) */}
      <div className="card" style={cardStyle}>
        <h2 style={groupTitleStyle}>
          {t(DEFAULT_LOCALE, "settings.content.sectionTitle")}
        </h2>
        <TextField
          label={t(DEFAULT_LOCALE, "settings.content.introTagline")}
          value={introTagline}
          maxLength={CONTENT_LIMITS.introTagline}
          hint={t(DEFAULT_LOCALE, "settings.content.introTaglineHint")}
          onChange={(v) => {
            markDirty();
            setIntroTagline(v);
          }}
        />
        <TextAreaField
          label={t(DEFAULT_LOCALE, "settings.content.outroMessage")}
          value={outroMessage}
          maxLength={CONTENT_LIMITS.outroMessage}
          onChange={(v) => {
            markDirty();
            setOutroMessage(v);
          }}
        />
        {/* Kontakt-E-Mail ist nach oben in die „Betrieb"-Gruppe gewandert
            (Block B, Punkt 6) — dieselbe contact_email, eine Quelle. */}
        <TextField
          label={t(DEFAULT_LOCALE, "settings.content.contactPhone")}
          value={contactPhone}
          maxLength={CONTENT_LIMITS.contactPhone}
          placeholder="+49 …"
          onChange={(v) => {
            markDirty();
            setContactPhone(v);
          }}
        />
      </div>

      {/* KI-Stil — Fach-/Stilkontext, der die KI-Textgenerierung erdet (8a-1b) */}
      <div className="card" style={cardStyle}>
        <h2 style={groupTitleStyle}>
          {t(DEFAULT_LOCALE, "settings.aiContext.sectionTitle")}
        </h2>
        <TextAreaField
          label={t(DEFAULT_LOCALE, "settings.aiContext.label")}
          value={aiContext}
          maxLength={CONTENT_LIMITS.aiContext}
          hint={t(DEFAULT_LOCALE, "settings.aiContext.hint")}
          placeholder={t(DEFAULT_LOCALE, "settings.aiContext.placeholder")}
          onChange={(v) => {
            markDirty();
            setAiContext(v);
          }}
        />
      </div>

      {/* Auslieferung */}
      <div className="card" style={cardStyle}>
        <h2 style={groupTitleStyle}>{t(DEFAULT_LOCALE, "settings.groupDelivery")}</h2>
        <Toggle
          label={t(DEFAULT_LOCALE, "settings.connectorRoapp")}
          checked={connectorRoapp}
          onChange={(v) => {
            markDirty();
            setConnectorRoapp(v);
          }}
        />
        <span style={hintStyle}>
          {t(DEFAULT_LOCALE, "settings.connectorRoappHint")}
        </span>
        <SelectField
          label={t(DEFAULT_LOCALE, "settings.deliveryMode")}
          value={deliveryMode}
          onChange={(v) => {
            if (isDeliveryMode(v)) {
              markDirty();
              setDeliveryMode(v);
            }
          }}
          options={DELIVERY_MODES.map((mode) => ({
            value: mode,
            label: t(
              DEFAULT_LOCALE,
              mode === "manual" ? "settings.deliveryManual" : "settings.deliveryAuto",
            ),
          }))}
        />
        <RangeNumberField
          label={t(DEFAULT_LOCALE, "settings.retentionMonths")}
          value={retentionMonths}
          min={RETENTION_MONTHS.min}
          max={RETENTION_MONTHS.max}
          onChange={(v) => {
            markDirty();
            setRetentionMonths(v);
          }}
          hint={t(DEFAULT_LOCALE, "settings.retentionMonthsHint", {
            min: RETENTION_MONTHS.min,
            max: RETENTION_MONTHS.max,
          })}
        />
      </div>

      {/* Speichern + Status. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          role="button"
          tabIndex={0}
          aria-disabled={saving}
          className="btn-dark"
          style={{
            minWidth: 160,
            opacity: saving ? 0.7 : 1,
            pointerEvents: saving ? "none" : "auto",
          }}
          onClick={() => void handleSave()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") void handleSave();
          }}
        >
          {t(DEFAULT_LOCALE, "settings.save")}
        </div>

        {saveState === "saved" ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: "#3F8F4F" }}>
            {t(DEFAULT_LOCALE, "settings.saved")}
          </span>
        ) : null}
        {saveState === "error" && errorMsg ? (
          <span style={{ fontSize: 13, color: "#B23B3B" }}>{errorMsg}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Beschriftetes Textfeld (einzeilig). */
function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: "text" | "url" | "email";
  maxLength?: number;
}) {
  return (
    <label style={labelStyle}>
      <span style={captionStyle}>{label}</span>
      <input
        type={type}
        className="form-input"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span style={hintStyle}>{hint}</span> : null}
    </label>
  );
}

/** Beschriftetes mehrzeiliges Textfeld (Textarea). */
function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <label style={labelStyle}>
      <span style={captionStyle}>{label}</span>
      <textarea
        className="form-input"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        style={{ resize: "vertical", minHeight: 76, fontFamily: "inherit" }}
      />
      {hint ? <span style={hintStyle}>{hint}</span> : null}
    </label>
  );
}

/** Farb-Feld: Swatch (`<input type="color">`) + synchroner Hex-Texteingabe. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={labelStyle}>
      <span style={captionStyle}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="color"
          value={isHexColor(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          style={{
            width: 44,
            height: 40,
            flexShrink: 0,
            padding: 2,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            background: "var(--bg)",
            cursor: "pointer",
          }}
        />
        <input
          type="text"
          className="form-input"
          value={value}
          placeholder="#RRGGBB"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </label>
  );
}

/** Auswahl-Feld (`<select>`) auf Basis von `.form-input`. */
function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label style={labelStyle}>
      <span style={captionStyle}>{label}</span>
      <select
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Zahlenfeld mit gekoppeltem Range-Slider (gemeinsamer Wert). */
function RangeNumberField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  hint?: string;
}) {
  return (
    <label style={labelStyle}>
      <span style={captionStyle}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: "var(--gold)" }}
        />
        <input
          type="number"
          className="form-input"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: 92, flexShrink: 0 }}
        />
      </div>
      {hint ? <span style={hintStyle}>{hint}</span> : null}
    </label>
  );
}

/** Toggle-Schalter (div + onClick, `role="switch"`). */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
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
        tabIndex={0}
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onChange(!checked);
        }}
        style={{
          width: 46,
          height: 26,
          flexShrink: 0,
          padding: 3,
          borderRadius: 999,
          cursor: "pointer",
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
            boxShadow: "0 1px 2px rgba(0, 0, 0, 0.2)",
          }}
        />
      </div>
    </div>
  );
}

/** Aktueller Vorgang des Logo-Felds (für Button-Label + Deaktivierung). */
type LogoBusy = "idle" | "uploading" | "removing";

/** Mappt einen Aufbereitungsfehler auf die passende i18n-Meldung. */
function logoErrorMessage(err: unknown): string {
  if (err instanceof LogoPrepareError) {
    if (err.code === "type") return t(DEFAULT_LOCALE, "settings.logo.typeError");
    if (err.code === "tooLarge") return t(DEFAULT_LOCALE, "settings.logo.tooLarge");
  }
  return t(DEFAULT_LOCALE, "settings.logo.error");
}

/**
 * Logo-Feld (eigene Mutations-Logik, getrennt vom „Speichern" der Form).
 * Hat ein Logo → Vorschau (signierte URL bzw. optimistische objectURL) +
 * „Entfernen"; sonst Upload-Control. Upload zweistufig & isolations-sicher wie
 * der Capture-Flow: `prepareLogo` → Direktupload in den privaten Bucket
 * `branding` unter `${businessId}/logo.png` (Storage-RLS bindet das erste Segment
 * an die business_id) → POST (ohne `business_id`) → `router.refresh()`.
 */
function LogoField({
  businessId,
  initialPreviewUrl,
}: {
  businessId: string;
  initialPreviewUrl: string | null;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);
  const [busy, setBusy] = useState<LogoBusy>("idle");
  const [error, setError] = useState<string | null>(null);

  // Lokale objectURL der optimistischen Vorschau — beim Server-Refresh/Unmount frei.
  const localUrlRef = useRef<string | null>(null);
  const revokeLocal = () => {
    if (localUrlRef.current) {
      URL.revokeObjectURL(localUrlRef.current);
      localUrlRef.current = null;
    }
  };

  // Server-Refresh liefert eine frische Signed-URL (oder null) → übernehmen,
  // die optimistische objectURL wird damit überflüssig und freigegeben.
  useEffect(() => {
    revokeLocal();
    setPreviewUrl(initialPreviewUrl);
  }, [initialPreviewUrl]);

  // Unmount-Bereinigung.
  useEffect(() => () => revokeLocal(), []);

  const path = `${businessId}/logo.png`;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneute Auswahl derselben Datei
    if (!file) return;
    setError(null);

    let prepared: PreparedLogo;
    try {
      prepared = await prepareLogo(file);
    } catch (err) {
      setError(logoErrorMessage(err));
      return;
    }

    setBusy("uploading");
    try {
      const { error: upErr } = await supabase.storage
        .from("branding")
        .upload(path, prepared.blob, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;

      const res = await fetch("/api/portal/settings/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: path }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Optimistische Vorschau bis der Refresh die Signed-URL nachliefert.
      revokeLocal();
      const localUrl = URL.createObjectURL(prepared.blob);
      localUrlRef.current = localUrl;
      setPreviewUrl(localUrl);
      router.refresh();
    } catch (err) {
      console.error(`[logo] Upload fehlgeschlagen (business ${businessId}):`, err);
      setError(t(DEFAULT_LOCALE, "settings.logo.error"));
    } finally {
      setBusy("idle");
    }
  };

  const handleRemove = async () => {
    setError(null);
    setBusy("removing");
    try {
      const res = await fetch("/api/portal/settings/logo", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      revokeLocal();
      setPreviewUrl(null);
      router.refresh();
    } catch (err) {
      console.error(`[logo] Entfernen fehlgeschlagen (business ${businessId}):`, err);
      setError(t(DEFAULT_LOCALE, "settings.logo.error"));
    } finally {
      setBusy("idle");
    }
  };

  const disabled = busy !== "idle";
  const disabledStyle: React.CSSProperties = {
    opacity: disabled ? 0.7 : 1,
    pointerEvents: disabled ? "none" : "auto",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input
        ref={inputRef}
        type="file"
        accept={LOGO_ACCEPT_ATTR}
        style={{ display: "none" }}
        onChange={(e) => void handleFile(e)}
      />

      {previewUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Signed-URL/objectURL, keine next/image-Optimierung. */}
          <img
            src={previewUrl}
            alt={t(DEFAULT_LOCALE, "settings.logo.preview")}
            style={{
              width: 96,
              height: 96,
              flexShrink: 0,
              objectFit: "contain",
              padding: 8,
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              background: "var(--surface-2)",
            }}
          />
          <div
            role="button"
            tabIndex={0}
            aria-disabled={disabled}
            className="btn-outline"
            style={disabledStyle}
            onClick={() => void handleRemove()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") void handleRemove();
            }}
          >
            {busy === "removing"
              ? t(DEFAULT_LOCALE, "settings.logo.removing")
              : t(DEFAULT_LOCALE, "settings.logo.remove")}
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-disabled={disabled}
          className="btn-outline"
          style={{ ...disabledStyle, alignSelf: "flex-start" }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
        >
          {busy === "uploading"
            ? t(DEFAULT_LOCALE, "settings.logo.uploading")
            : t(DEFAULT_LOCALE, "settings.logo.upload")}
        </div>
      )}

      {error ? (
        <span style={{ fontSize: 13, color: "#B23B3B" }}>{error}</span>
      ) : null}
    </div>
  );
}

/** Mappt einen Hintergrund-Aufbereitungsfehler auf die passende i18n-Meldung. */
function backgroundErrorMessage(err: unknown): string {
  if (err instanceof BackgroundPrepareError) {
    if (err.code === "type")
      return t(DEFAULT_LOCALE, "settings.background.typeError");
    if (err.code === "tooLarge")
      return t(DEFAULT_LOCALE, "settings.background.tooLarge");
  }
  return t(DEFAULT_LOCALE, "settings.background.error");
}

/**
 * Hintergrund-Feld für einen Slot (Intro/Outro) — bewusst aus dem 7a-LogoField
 * generalisiert, aber **einmal** definiert und für beide Slots verwendet (keine
 * Intro/Outro-Duplikation; das Logo-Feld bleibt unverändert). Eigene Mutations-
 * Logik, getrennt vom „Speichern" der Form. Hat ein Bild → Vorschau (signierte
 * URL bzw. optimistische objectURL) + „Entfernen"; sonst Upload-Control. Upload
 * zweistufig & isolations-sicher wie das Logo: `prepareBackground` (JPEG) →
 * Direktupload in den privaten Bucket `branding` unter `${businessId}/${slot}-bg.jpg`
 * (Storage-RLS bindet das erste Segment an die business_id) → POST (ohne
 * `business_id`, nur `{ storage_path, slot }`) → `router.refresh()`.
 */
function ImageUploadField({
  businessId,
  slot,
  label,
  initialPreviewUrl,
  previewAspect = 16 / 9,
  previewFit = "cover",
}: {
  businessId: string;
  slot: BackgroundSlot;
  label: string;
  initialPreviewUrl: string | null;
  /** Vorschau-Seitenverhältnis (Breite/Höhe). Default = bisheriges Querformat. */
  previewAspect?: number;
  /** Vorschau-`object-fit`. Default = bisheriges Verhalten. */
  previewFit?: "cover" | "contain";
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);
  const [busy, setBusy] = useState<LogoBusy>("idle");
  const [error, setError] = useState<string | null>(null);

  // Lokale objectURL der optimistischen Vorschau — beim Server-Refresh/Unmount frei.
  const localUrlRef = useRef<string | null>(null);
  const revokeLocal = () => {
    if (localUrlRef.current) {
      URL.revokeObjectURL(localUrlRef.current);
      localUrlRef.current = null;
    }
  };

  // Server-Refresh liefert eine frische Signed-URL (oder null) → übernehmen,
  // die optimistische objectURL wird damit überflüssig und freigegeben.
  useEffect(() => {
    revokeLocal();
    setPreviewUrl(initialPreviewUrl);
  }, [initialPreviewUrl]);

  // Unmount-Bereinigung.
  useEffect(() => () => revokeLocal(), []);

  const path = backgroundStoragePath(businessId, slot);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // erlaubt erneute Auswahl derselben Datei
    if (!file) return;
    setError(null);

    let blob: Blob;
    try {
      ({ blob } = await prepareBackground(file));
    } catch (err) {
      setError(backgroundErrorMessage(err));
      return;
    }

    setBusy("uploading");
    try {
      const { error: upErr } = await supabase.storage
        .from("branding")
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;

      const res = await fetch("/api/portal/settings/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: path, slot }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Optimistische Vorschau bis der Refresh die Signed-URL nachliefert.
      revokeLocal();
      const localUrl = URL.createObjectURL(blob);
      localUrlRef.current = localUrl;
      setPreviewUrl(localUrl);
      router.refresh();
    } catch (err) {
      console.error(
        `[background] Upload fehlgeschlagen (business ${businessId}, slot ${slot}):`,
        err,
      );
      setError(t(DEFAULT_LOCALE, "settings.background.error"));
    } finally {
      setBusy("idle");
    }
  };

  const handleRemove = async () => {
    setError(null);
    setBusy("removing");
    try {
      const res = await fetch("/api/portal/settings/background", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      revokeLocal();
      setPreviewUrl(null);
      router.refresh();
    } catch (err) {
      console.error(
        `[background] Entfernen fehlgeschlagen (business ${businessId}, slot ${slot}):`,
        err,
      );
      setError(t(DEFAULT_LOCALE, "settings.background.error"));
    } finally {
      setBusy("idle");
    }
  };

  const disabled = busy !== "idle";
  const disabledStyle: React.CSSProperties = {
    opacity: disabled ? 0.7 : 1,
    pointerEvents: disabled ? "none" : "auto",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={captionStyle}>{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept={BACKGROUND_ACCEPT_ATTR}
        style={{ display: "none" }}
        onChange={(e) => void handleFile(e)}
      />

      {previewUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Signed-URL/objectURL, keine next/image-Optimierung. */}
          <img
            src={previewUrl}
            alt={t(DEFAULT_LOCALE, "settings.background.preview")}
            style={{
              width: 160,
              maxWidth: 160,
              aspectRatio: String(previewAspect),
              flexShrink: 0,
              objectFit: previewFit,
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              background: "var(--surface-2)",
            }}
          />
          <div
            role="button"
            tabIndex={0}
            aria-disabled={disabled}
            className="btn-outline"
            style={disabledStyle}
            onClick={() => void handleRemove()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") void handleRemove();
            }}
          >
            {t(DEFAULT_LOCALE, "settings.background.remove")}
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-disabled={disabled}
          className="btn-outline"
          style={{ ...disabledStyle, alignSelf: "flex-start" }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
        >
          {busy === "uploading"
            ? t(DEFAULT_LOCALE, "settings.background.uploading")
            : t(DEFAULT_LOCALE, "settings.background.upload")}
        </div>
      )}

      <span style={{ ...captionStyle, fontSize: 12 }}>
        {t(DEFAULT_LOCALE, "settings.background.previewHint")}
      </span>

      {error ? (
        <span style={{ fontSize: 13, color: "#B23B3B" }}>{error}</span>
      ) : null}
    </div>
  );
}
