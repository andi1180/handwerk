"use client";

import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Druck-Auslöser der QR-Druckansicht (Schritt 9c-2). Kleine Client-Komponente,
 * damit die Seite selbst eine Server Component bleiben kann (QR wird
 * server-seitig erzeugt). `window.print()` öffnet den nativen Druckdialog;
 * das `@media print`-CSS blendet Portal-Chrome + diesen Button aus, sodass nur
 * die QR-Karte druckt.
 */
export function QrPrintButton() {
  return (
    <button
      type="button"
      className="btn-dark"
      onClick={() => window.print()}
    >
      {t(DEFAULT_LOCALE, "qr.printButton")}
    </button>
  );
}
