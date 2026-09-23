"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TIER_NAMES, isTierName, type TierName } from "@/lib/entitlements/model";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/** `<select>`-Wert für „kein Tier" (DB: `null`). */
const NONE = "";

/**
 * Tier-Editor in der Tier-Spalte der Admin-Betriebsliste (A4b-1).
 *
 * `<select>` (kein Tier + die drei `TIER_NAMES`) + „Speichern". Speichern ist
 * deaktiviert, solange die Auswahl dem gespeicherten Wert entspricht; vor dem
 * PATCH eine `window.confirm`-Rückfrage mit Betriebsname und alt → neu
 * (Projekt-Konvention). Erfolg ⇒ `router.refresh()`, Fehler ⇒ Inline-Text,
 * Auswahl bleibt für einen erneuten Versuch stehen. Kein `<form>`.
 */
export function TierEditor({
  businessId,
  businessName,
  currentTier,
}: {
  businessId: string;
  businessName: string;
  currentTier: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(currentTier ?? NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refreshing, startTransition] = useTransition();

  const current = currentTier ?? NONE;
  const pending = busy || refreshing;
  const unchanged = selected === current;

  function label(value: string): string {
    return value === NONE ? t(DEFAULT_LOCALE, "admin.tier.noneValue") : value;
  }

  async function handleSave() {
    if (pending || unchanged) return;

    let next: TierName | null;
    if (selected === NONE) next = null;
    else if (isTierName(selected)) next = selected;
    else return;

    const ok = window.confirm(
      t(DEFAULT_LOCALE, "admin.tier.confirm", {
        name: businessName,
        from: label(current),
        to: label(selected),
      }),
    );
    if (!ok) return;

    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}/tier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: next }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  // Defensiv: ein gespeicherter Wert außerhalb der Liste (DB-CHECK verhindert
  // das eigentlich) bleibt als Option sichtbar, statt still zu verschwinden.
  const unknownCurrent = current !== NONE && !isTierName(current);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setError(false);
          }}
          disabled={pending}
          aria-label={t(DEFAULT_LOCALE, "admin.tier.selectLabel", {
            name: businessName,
          })}
          style={{
            font: "inherit",
            fontSize: 13,
            padding: "4px 6px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--surface)",
            color: "inherit",
          }}
        >
          <option value={NONE}>{t(DEFAULT_LOCALE, "admin.tier.none")}</option>
          {TIER_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {unknownCurrent ? <option value={current}>{current}</option> : null}
        </select>
        <button
          type="button"
          className="btn-dark"
          onClick={handleSave}
          disabled={pending || unchanged}
          style={{
            padding: "4px 10px",
            fontSize: 12,
            minHeight: 0,
            opacity: pending || unchanged ? 0.45 : 1,
            cursor: pending || unchanged ? "default" : "pointer",
          }}
        >
          {pending
            ? t(DEFAULT_LOCALE, "admin.tier.saving")
            : t(DEFAULT_LOCALE, "admin.tier.save")}
        </button>
      </div>
      {error ? (
        <span style={{ fontSize: 12, color: "var(--red-text)" }} role="alert">
          {t(DEFAULT_LOCALE, "admin.tier.error")}
        </span>
      ) : null}
    </div>
  );
}
