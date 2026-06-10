"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import type { CurrentBusiness } from "@/lib/auth/current-business";
import {
  DELIVERY_MODES,
  FONT_OPTIONS,
  RETENTION_MONTHS,
  VIDEO_SECONDS,
  isDeliveryMode,
  isFontOption,
  isHexColor,
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
export function SettingsForm({ business }: { business: CurrentBusiness }) {
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
  const [igHandle, setIgHandle] = useState(business.settings.ig_handle ?? "");
  const [googleReviewUrl, setGoogleReviewUrl] = useState(
    business.settings.google_review_url ?? "",
  );
  const [websiteUrl, setWebsiteUrl] = useState(business.settings.website_url ?? "");
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(
    business.settings.delivery_mode,
  );
  const [retentionMonths, setRetentionMonths] = useState(business.retention_months);

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
          ig_handle: igHandle,
          google_review_url: googleReviewUrl,
          website_url: websiteUrl,
          delivery_mode: deliveryMode,
          retention_months: retentionMonths,
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

      {/* Auslieferung */}
      <div className="card" style={cardStyle}>
        <h2 style={groupTitleStyle}>{t(DEFAULT_LOCALE, "settings.groupDelivery")}</h2>
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: "text" | "url";
}) {
  return (
    <label style={labelStyle}>
      <span style={captionStyle}>{label}</span>
      <input
        type={type}
        className="form-input"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
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
