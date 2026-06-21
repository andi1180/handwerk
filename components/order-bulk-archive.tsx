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
import {
  buildOrdersUrl,
  type QuickFilter,
  type StatusFilter,
} from "@/lib/orders/filters";

/**
 * Mehrfach-Auswahl + Bulk-Archivieren (Schritt 3a) + „Alle auswählen" pro
 * aktivem Filter über alle Seiten (Schritt 3b-2b).
 *
 * Eine Client-Auswahl-Schicht über die server-gerenderte Auftragsliste: der
 * Provider liefert per Context den Auswahl-State; die server-gerenderten Kacheln
 * (Children) enthalten Client-Kontrollen (`OrderRowControls`), die den Context
 * lesen. So bleibt die Liste eine Server-Component, der bestehende `<Link>`/das
 * Einzel-Archiv-Icon brechen nicht.
 *
 * Auswahl-UI NUR im Hauptlisten-Scope (Archiv-Scope rendert keine
 * `OrdersArchiveMenu` ⇒ `selectMode` bleibt false ⇒ keine Checkboxen, keine Bar).
 *
 * Zwei sich ausschließende Auswahl-Modi innerhalb des Select-Mode:
 *  - IDs-Modus           — einzeln angetippte Kacheln (`selected`).
 *  - All-gefiltert-Modus — „Alle auswählen": der Server zählt ALLE archivierbaren
 *    Treffer des aktiven Filters (`allFilteredCount`, über alle Seiten); das
 *    Archivieren postet dann `{ scope:"filter", status, quick }` statt der IDs.
 * Eine Einzelauswahl verlässt den All-gefiltert-Modus; „Alle auswählen" leert die
 * Einzelauswahl. Der aktive Filter (`status`/`quick`) kommt als Prop aus der Seite.
 */

type BulkSelectContextValue = {
  selectMode: boolean;
  enterSelectMode: () => void;
  exitSelectMode: () => void;
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  clear: () => void;
  /** Aktiver Listen-Filter (für „Alle auswählen" → by-filter-Bulk). */
  status: StatusFilter | null;
  quick: QuickFilter | null;
  /** Aktiver Freitext-Suchbegriff (Schritt B) — orthogonal zu status/quick. */
  q: string | null;
  /** Anzahl im All-gefiltert-Modus, sonst `null` (= IDs-Modus). */
  allFilteredCount: number | null;
  /** In den All-gefiltert-Modus wechseln (leert die Einzelauswahl). */
  selectAllFiltered: (count: number) => void;
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
  status,
  quick,
  q,
  children,
}: {
  orderIds: string[];
  status: StatusFilter | null;
  quick: QuickFilter | null;
  q: string | null;
  children: React.ReactNode;
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [allFilteredCount, setAllFilteredCount] = useState<number | null>(null);

  // Bei Listen- ODER Filter-Wechsel (Pagination / Filter / Refresh nach dem
  // Archivieren) Auswahl + Modus zurücksetzen — nichts wird über Seiten/Filter
  // getragen (eine All-gefiltert-Auswahl gälte sonst für den falschen Filter).
  const idsKey = orderIds.join(",");
  const filterKey = `${status ?? ""}|${quick ?? ""}|${q ?? ""}`;
  useEffect(() => {
    setSelected(new Set());
    setSelectMode(false);
    setAllFilteredCount(null);
  }, [idsKey, filterKey]);

  const toggle = useCallback((id: string) => {
    // Eine Einzelauswahl verlässt den All-gefiltert-Modus (zurück zu IDs).
    setAllFilteredCount(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    setAllFilteredCount(null);
  }, []);
  const enterSelectMode = useCallback(() => setSelectMode(true), []);
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    setAllFilteredCount(null);
  }, []);
  const selectAllFiltered = useCallback((count: number) => {
    setSelected(new Set());
    setAllFilteredCount(count);
  }, []);

  const value = useMemo<BulkSelectContextValue>(
    () => ({
      selectMode,
      enterSelectMode,
      exitSelectMode,
      selected,
      toggle,
      clear,
      status,
      quick,
      q,
      allFilteredCount,
      selectAllFiltered,
    }),
    [
      selectMode,
      enterSelectMode,
      exitSelectMode,
      selected,
      toggle,
      clear,
      status,
      quick,
      q,
      allFilteredCount,
      selectAllFiltered,
    ],
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
 * Fixierte Toolbar, sichtbar im gesamten Auswahl-Modus (damit „Alle auswählen"
 * auch ohne vorherige Einzelauswahl erreichbar ist). „Archivieren" verlangt einen
 * inline-Bestätigungsschritt (keine stille Aktion).
 *
 * Drei Zustände (ohne Bestätigung):
 *  - leer (0 ausgewählt)   → nur „Alle auswählen".
 *  - IDs (≥1 angetippt)    → „{n} ausgewählt" + „Alle auswählen" + Archivieren + aufheben.
 *  - All-gefiltert         → „Alle {N} ausgewählt" + Archivieren + aufheben.
 * „Alle auswählen" holt den exakten Count des aktiven Filters (`GET ?scope=filter`)
 * und wechselt bei N>0 in den All-gefiltert-Modus; N===0 ⇒ nur ein Hinweis.
 */
function BulkArchiveBar() {
  const router = useRouter();
  const {
    selectMode,
    selected,
    clear,
    exitSelectMode,
    status,
    quick,
    q,
    allFilteredCount,
    selectAllFiltered,
  } = useBulkSelect();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const [selectAllBusy, setSelectAllBusy] = useState(false);

  const idsCount = selected.size;
  const allFiltered = allFilteredCount !== null;
  const effectiveCount = allFiltered ? allFilteredCount : idsCount;
  const visible = selectMode;

  // Zustände zurücksetzen, sobald die Bar verschwindet (Modus verlassen).
  useEffect(() => {
    if (!visible) {
      setConfirming(false);
      setError(false);
    }
  }, [visible]);

  // Fällt die Auswahl auf 0 (z. B. letzte Kachel abgewählt), Bestätigung verwerfen.
  useEffect(() => {
    if (effectiveCount === 0) setConfirming(false);
  }, [effectiveCount]);

  if (!visible) return null;

  // „Alle auswählen": exakten Count des AKTIVEN Filters über alle Seiten holen.
  // N>0 ⇒ All-gefiltert-Modus; N===0 ⇒ nur Hinweis (kein Modus).
  async function handleSelectAll() {
    if (selectAllBusy) return;
    setSelectAllBusy(true);
    setError(false);
    try {
      const params = new URLSearchParams({ scope: "filter" });
      if (quick) params.set("quick", quick);
      else if (status) params.set("status", status);
      if (q) params.set("q", q); // Freitext-Suche orthogonal zu status/quick
      const res = await fetch(
        `/api/portal/orders/archive-bulk?${params.toString()}`,
      );
      if (!res.ok) {
        console.error("[order-bulk-archive] filter count failed", res.status);
        setError(true);
        return;
      }
      const { count } = (await res.json()) as { count: number };
      if (!count) {
        window.alert(t(DEFAULT_LOCALE, "orders.noneToArchive"));
        return;
      }
      selectAllFiltered(count);
    } catch (err) {
      console.error("[order-bulk-archive] filter count error", err);
      setError(true);
    } finally {
      setSelectAllBusy(false);
    }
  }

  async function handleArchive() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      // All-gefiltert ⇒ `{ scope:"filter", status, quick }` (alle Seiten);
      // sonst die angetippten IDs (3a).
      const body = allFiltered
        ? { scope: "filter", status, quick, q, archive: true }
        : { ids: [...selected], archive: true };
      const res = await fetch("/api/portal/orders/archive-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
            {t(DEFAULT_LOCALE, "orders.confirmArchive", { n: effectiveCount })}
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
              : allFiltered
                ? t(DEFAULT_LOCALE, "orders.allFilteredSelected", {
                    n: effectiveCount,
                  })
                : t(DEFAULT_LOCALE, "orders.selected", { n: idsCount })}
          </span>
          <div className="bulk-bar-actions">
            {!allFiltered ? (
              <button
                type="button"
                className="bulk-bar-btn"
                onClick={handleSelectAll}
                disabled={selectAllBusy}
              >
                {t(DEFAULT_LOCALE, "orders.selectAllFiltered")}
              </button>
            ) : null}
            {effectiveCount > 0 ? (
              <button
                type="button"
                className="bulk-bar-btn bulk-bar-btn--primary"
                onClick={() => setConfirming(true)}
              >
                {t(DEFAULT_LOCALE, "orders.archiveSelected")}
              </button>
            ) : null}
            {effectiveCount > 0 ? (
              <button type="button" className="bulk-bar-btn" onClick={clear}>
                {t(DEFAULT_LOCALE, "orders.clearSelection")}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
