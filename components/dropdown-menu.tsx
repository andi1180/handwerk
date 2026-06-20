"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/**
 * Minimales, abhängigkeitsfreies Dropdown-Menü im Stil der bestehenden UI.
 *
 * Trigger-Button (Label + Chevron) öffnet/schließt ein Menü; Klick außerhalb
 * und Escape schließen. Die Menü-Einträge kommen als Children (`<DropdownItem>`)
 * — so bleibt die Komponente generisch und ein weiterer Eintrag ist trivial.
 *
 * Bewusst KEINE Bibliothek/Dependency und keine vollständige ARIA-Tastatur-
 * navigation (Pfeiltasten) — nur das, was hier gebraucht wird.
 */

type DropdownContextValue = { close: () => void };
const DropdownContext = createContext<DropdownContextValue | null>(null);

/** Chevron im Trigger (zeigt „aufklappbar" an; rotiert im offenen Zustand). */
function ChevronIcon() {
  return (
    <svg
      className="dropdown-chevron"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function DropdownMenu({
  trigger,
  triggerClassName,
  ariaLabel,
  children,
}: {
  trigger: React.ReactNode;
  triggerClassName?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Klick außerhalb / Escape schließt — nur registriert, solange offen.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
        <ChevronIcon />
      </button>
      {open ? (
        <div className="dropdown-menu" id={menuId} role="menu">
          <DropdownContext.Provider value={{ close: () => setOpen(false) }}>
            {children}
          </DropdownContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ein Menü-Eintrag. `href` → navigierender `<Link>`, sonst ein `<button>` mit
 * `onSelect`. Beide schließen das Menü nach dem Klick.
 */
export function DropdownItem({
  href,
  onSelect,
  children,
}: {
  href?: string;
  onSelect?: () => void;
  children: React.ReactNode;
}) {
  const close = useContext(DropdownContext)?.close ?? (() => {});

  if (href) {
    return (
      <Link
        href={href}
        role="menuitem"
        className="dropdown-item"
        onClick={close}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      className="dropdown-item"
      onClick={() => {
        onSelect?.();
        close();
      }}
    >
      {children}
    </button>
  );
}
