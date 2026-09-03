/**
 * Wiederverwendbares Kopieren in die Zwischenablage (moderne API + Legacy-Fallback).
 *
 * SSR-sicher: `navigator`/`document` werden ausschließlich in den Funktions-
 * körpern berührt — beim bloßen Import läuft KEIN Code, der Browser-Globals
 * voraussetzt. Reines Verhalten, keine React-Abhängigkeit; wird nur von
 * Client-Komponenten importiert.
 *
 * Lift-and-Shift aus app/b/[token]/share-bar.tsx (Verhalten unverändert) —
 * geteilt, weil jetzt AUCH das Bewertungs-Popup den Entwurf ablegt.
 */

/**
 * Erst die moderne Clipboard-API, sonst der Legacy-Pfad.
 * Die Web-Story wird oft aus In-App-Webviews (WhatsApp/Instagram) geöffnet, wo
 * `navigator.clipboard` fehlt oder blockiert ist; dort greift `execCommand`,
 * damit der „ist kopiert"-Hinweis auch wirklich stimmt.
 * Gibt zurück, ob das Kopieren tatsächlich geklappt hat.
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Moderne API verweigert (kein HTTPS / kein Fokus) → Legacy-Fallback.
  }
  return legacyCopy(text);
}

/** Legacy-Kopierpfad (verstecktes <textarea> + execCommand) — best effort. */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
