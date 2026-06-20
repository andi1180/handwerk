"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { ArchiveToggle } from "@/components/archive-toggle";

/**
 * Mehrfach-Auswahl + Bulk-Archivieren (Schritt 3a).
 *
 * Eine Client-Auswahl-Schicht über die server-gerenderte Auftragsliste: der
 * Provider liefert per Context den Auswahl-State; die server-gerenderten Kacheln
 * (Children) enthalten Client-Kontrollen (`OrderRowControls`), die den Context
 * lesen. So bleibt die Liste eine Server-Component, der bestehende `<Link>`/das
 * Einzel-Archiv-Icon brechen nicht.
 *
 * Auswahl-UI NUR im Hauptlisten-Scope (Archiv-Scope rendert keinen
 * `SelectModeToggle` ⇒ `selectMode` bleibt false ⇒ keine Checkboxen, keine Bar).
 * KEIN „Alle auswählen", KEIN Per-Filter-Bulk, KEINE Auto-Archivierung (3b).
 */

type BulkSelectContextValue = {
  selectMode: boolean;
  enterSelectMode: () => void;
  exitSelectMode: () => void;
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  clear: () => void;
};

const BulkSelectContext = createContext<BulkSelectContextValue | null>(null);

function useBulkSelect(): BulkSelectContextValue {
  const ctx = useContext(BulkSelectContext);
  if (!ctx) {
    throw new Error(
      "useBulkSelect must be used within an OrderBulkSelectProvider",
    );
  }
  return ctx;
}

export function OrderBulkSelectProvider({
  orderIds,
  children,
}: {
  orderIds: string[];
  children: React.ReactNode;
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Bei Listen-Wechsel (Pagination / Refresh nach dem Archivieren) Auswahl +
  // Modus zurücksetzen — die Auswahl wird nicht über Seiten/Refreshs getragen.
  const idsKey = orderIds.join(",");
  useEffect(() => {
    setSelected(new Set());
    setSelectMode(false);
  }, [idsKey]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);
  const enterSelectMode = useCallback(() => setSelectMode(true), []);
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const value = useMemo<BulkSelectContextValue>(
    () => ({
      selectMode,
      enterSelectMode,
      exitSelectMode,
      selected,
      toggle,
      clear,
    }),
    [selectMode, enterSelectMode, exitSelectMode, selected, toggle, clear],
  );

  return (
    <BulkSelectContext.Provider value={value}>
      {children}
      <BulkArchiveBar />
    </BulkSelectContext.Provider>
  );
}

/** Kleines Kästchen-Icon (Mehrfach-Auswahl) für den Header-Toggle. */
function SelectIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

/** Header-Toggle: „Auswählen" ⇄ „Abbrechen" (nur Hauptlisten-Scope). */
export function SelectModeToggle() {
  const { selectMode, enterSelectMode, exitSelectMode } = useBulkSelect();
  return (
    <button
      type="button"
      className="orders-archive-link"
      onClick={selectMode ? exitSelectMode : enterSelectMode}
      aria-pressed={selectMode}
    >
      <SelectIcon />
      <span>
        {t(DEFAULT_LOCALE, selectMode ? "orders.cancel" : "orders.select")}
      </span>
    </button>
  );
}

/** Häkchen für den ausgewählten Zustand der Kachel-Checkbox. */
function CheckIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12l5 5L20 6" />
    </svg>
  );
}

/**
 * Rechtsbündige Kachel-Kontrolle. Entscheidet client-seitig (Context):
 *  - Archiv-Scope            → Entarchivieren-Icon (kein Select-Mode hier).
 *  - Hauptliste, archivierbar:
 *      • Select-Mode  → Auswahl-Checkbox (toggelt `selected`).
 *      • sonst        → Einzel-Archiv-Icon (bestehendes Verhalten).
 *  - Hauptliste, nicht archivierbar → nichts (wie bisher).
 *
 * Die Checkbox ist ein `<button>` im `<Link>` und stoppt die Propagation —
 * exakt das Muster des bestehenden Einzel-Archiv-Icons (kein Navigieren).
 */
export function OrderRowControls({
  orderId,
  archivable,
  archiveView,
}: {
  orderId: string;
  archivable: boolean;
  archiveView: boolean;
}) {
  const { selectMode, selected, toggle } = useBulkSelect();

  if (archiveView) {
    return <ArchiveToggle orderId={orderId} mode="unarchive" />;
  }
  if (!archivable) return null;
  if (!selectMode) {
    return <ArchiveToggle orderId={orderId} mode="archive" />;
  }

  const isSelected = selected.has(orderId);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      aria-label={t(DEFAULT_LOCALE, "orders.select")}
      className="order-select-check"
      data-selected={isSelected}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(orderId);
      }}
    >
      {isSelected ? <CheckIcon /> : null}
    </button>
  );
}

/**
 * Fixierte Toolbar, sichtbar sobald ≥1 Auftrag gewählt ist. „Archivieren"
 * verlangt einen inline-Bestätigungsschritt (keine stille Aktion).
 */
function BulkArchiveBar() {
  const router = useRouter();
  const { selectMode, selected, clear, exitSelectMode } = useBulkSelect();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);

  const count = selected.size;
  const visible = selectMode && count > 0;

  // Zustände zurücksetzen, sobald die Bar verschwindet (z. B. „Auswahl aufheben").
  useEffect(() => {
    if (!visible) {
      setConfirming(false);
      setError(false);
    }
  }, [visible]);

  if (!visible) return null;

  async function handleArchive() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/portal/orders/archive-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], archive: true }),
      });
      if (res.ok) {
        exitSelectMode(); // leert Auswahl + verlässt den Modus
        router.refresh();
      } else {
        console.error("[order-bulk-archive] request failed", res.status);
        setError(true);
        setConfirming(false);
      }
    } catch (err) {
      console.error("[order-bulk-archive] network error", err);
      setError(true);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="bulk-bar"
      role="region"
      aria-label={t(DEFAULT_LOCALE, "orders.archiveSelected")}
    >
      {confirming ? (
        <>
          <span className="bulk-bar-label">
            {t(DEFAULT_LOCALE, "orders.confirmArchive", { n: count })}
          </span>
          <div className="bulk-bar-actions">
            <button
              type="button"
              className="bulk-bar-btn bulk-bar-btn--primary"
              onClick={handleArchive}
              disabled={busy}
            >
              {t(DEFAULT_LOCALE, "orders.yes")}
            </button>
            <button
              type="button"
              className="bulk-bar-btn"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              {t(DEFAULT_LOCALE, "orders.cancel")}
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="bulk-bar-label">
            {error
              ? t(DEFAULT_LOCALE, "orders.archiveError")
              : t(DEFAULT_LOCALE, "orders.selected", { n: count })}
          </span>
          <div className="bulk-bar-actions">
            <button
              type="button"
              className="bulk-bar-btn bulk-bar-btn--primary"
              onClick={() => setConfirming(true)}
            >
              {t(DEFAULT_LOCALE, "orders.archiveSelected")}
            </button>
            <button type="button" className="bulk-bar-btn" onClick={clear}>
              {t(DEFAULT_LOCALE, "orders.clearSelection")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
