"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { ArchiveToggle } from "@/components/archive-toggle";
import { DropdownMenu, DropdownItem } from "@/components/dropdown-menu";
import { buildOrdersUrl } from "@/lib/orders/filters";

/**
 * Mehrfach-Auswahl + Bulk-Archivieren (Schritt 3a).
 *
 * Eine Client-Auswahl-Schicht über die server-gerenderte Auftragsliste: der
 * Provider liefert per Context den Auswahl-State; die server-gerenderten Kacheln
 * (Children) enthalten Client-Kontrollen (`OrderRowControls`), die den Context
 * lesen. So bleibt die Liste eine Server-Component, der bestehende `<Link>`/das
 * Einzel-Archiv-Icon brechen nicht.
 *
 * Auswahl-UI NUR im Hauptlisten-Scope (Archiv-Scope rendert keine
 * `OrdersArchiveMenu` ⇒ `selectMode` bleibt false ⇒ keine Checkboxen, keine Bar).
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

/** Archiv-Box-Icon für den Dropdown-Trigger. */
function ArchiveIcon() {
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
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12l2 2 2-2" />
      <path d="M12 12v4" />
    </svg>
  );
}

/**
 * Header-Control „Archiv ▾" (nur Hauptlisten-Scope). Fasst die früher zwei
 * separaten Trigger zusammen:
 *  - „Archiv"     → in den Archiv-Scope navigieren (`?archived=1`).
 *  - „Auswählen"  → Mehrfach-Auswahl-Modus starten.
 *
 * Im Auswahl-Modus wird derselbe Header-Slot zum direkten „Abbrechen"-Button
 * (kein Menü) — so bleibt der bisherige Abbrechen-Weg ohne Doppelung erhalten
 * (die Toolbar trägt weiterhin nur „Auswahl aufheben"). Das Menü ist so
 * angelegt, dass ein dritter Eintrag (3b: „Alle erledigten archivieren") leicht
 * ergänzt werden kann.
 */
export function OrdersArchiveMenu() {
  const { selectMode, enterSelectMode, exitSelectMode } = useBulkSelect();

  if (selectMode) {
    return (
      <button
        type="button"
        className="orders-archive-link"
        onClick={exitSelectMode}
        aria-pressed
      >
        <span>{t(DEFAULT_LOCALE, "orders.cancel")}</span>
      </button>
    );
  }

  return (
    <DropdownMenu
      triggerClassName="orders-archive-link"
      ariaLabel={t(DEFAULT_LOCALE, "orders.archiveMenu")}
      trigger={
        <>
          <ArchiveIcon />
          <span>{t(DEFAULT_LOCALE, "orders.archiveMenu")}</span>
        </>
      }
    >
      <DropdownItem href={buildOrdersUrl({ archived: true })}>
        {t(DEFAULT_LOCALE, "orders.archiveView")}
      </DropdownItem>
      <DropdownItem onSelect={enterSelectMode}>
        {t(DEFAULT_LOCALE, "orders.select")}
      </DropdownItem>
      <ArchiveAllDoneItem />
    </DropdownMenu>
  );
}

/**
 * Dropdown-Eintrag „Alle erledigten archivieren" (3b-2a). Holt zuerst die echte
 * Stückzahl (`GET ?scope=all-done`); bei 0 nur ein Hinweis, sonst eine
 * Bestätigung mit der Zahl. Bei „OK" archiviert EIN `POST { scope:"all-done" }`
 * alle archivierbaren aktiven Aufträge des Betriebs auf einmal (kein IDs-Array).
 *
 * `window.confirm`/`window.alert` sind hier die Projekt-Konvention — das Menü
 * schließt beim Klick (der Eintrag unmountet), darum keine inline-Bar wie beim
 * IDs-Bulk. Minimaler Lade-/Fehler-State über busy-Guard + try/catch/finally
 * (kein Hängen); `business_id` löst der Server aus der Session auf (nie Client).
 */
function ArchiveAllDoneItem() {
  const router = useRouter();
  const busyRef = useRef(false);

  async function handleAllDone() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const countRes = await fetch(
        "/api/portal/orders/archive-bulk?scope=all-done",
      );
      if (!countRes.ok) {
        console.error("[order-bulk-archive] all-done count failed", countRes.status);
        window.alert(t(DEFAULT_LOCALE, "orders.archiveError"));
        return;
      }
      const { count } = (await countRes.json()) as { count: number };
      if (!count) {
        window.alert(t(DEFAULT_LOCALE, "orders.noneToArchive"));
        return;
      }
      if (
        !window.confirm(
          t(DEFAULT_LOCALE, "orders.confirmArchiveAllDone", { n: count }),
        )
      ) {
        return;
      }
      const res = await fetch("/api/portal/orders/archive-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all-done", archive: true }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        console.error("[order-bulk-archive] all-done failed", res.status);
        window.alert(t(DEFAULT_LOCALE, "orders.archiveError"));
      }
    } catch (err) {
      console.error("[order-bulk-archive] all-done error", err);
      window.alert(t(DEFAULT_LOCALE, "orders.archiveError"));
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <DropdownItem onSelect={handleAllDone}>
      {t(DEFAULT_LOCALE, "orders.archiveAllDone")}
    </DropdownItem>
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
