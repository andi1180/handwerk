/**
 * Wiederverwendbare Datei-Teilen-Helfer (Web Share API + Download-Fallback).
 *
 * SSR-sicher: `window`/`navigator`/`document` werden ausschließlich in den
 * Funktionskörpern berührt — beim bloßen Import läuft KEIN Code, der Browser-
 * Globals voraussetzt. Reines Verhalten, keine React-Abhängigkeit; wird nur von
 * Client-Komponenten importiert.
 *
 * Lift-and-Shift aus app/b/[token]/share-bar.tsx — Verhalten unverändert.
 */

/**
 * Capability-Probe: Kann dieser Browser Dateien über die Web Share API teilen?
 *
 * Konstruiert ein Dummy-`File` und fragt `navigator.canShare({ files })`.
 * Liefert `false`, wenn `navigator`/`canShare` fehlt oder die Probe wirft.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    const probe = new File([new Blob([], { type: "video/mp4" })], "probe.mp4", {
      type: "video/mp4",
    });
    return (
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [probe] })
    );
  } catch {
    return false;
  }
}

/**
 * Lädt eine URL vorab und verpackt sie als `File` (Prefetch-Kern).
 *
 * `fetch` → `blob()` → `new File(...)`. Der optionale `AbortSignal` erlaubt dem
 * Aufrufer, den Prefetch beim Unmount abzubrechen. Wirft bei Nicht-2xx oder
 * abgebrochenem/fehlgeschlagenem `fetch` (der Aufrufer fängt das ab).
 */
export async function fetchAsShareFile(
  url: string,
  filename: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<File> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  return new File([blob], filename, { type: mimeType });
}

/**
 * Teilt eine bereits geladene Datei via `navigator.share({ files })`.
 *
 * WICHTIG: synchron aus der User-Geste aufrufen (ohne `await` davor) — der
 * `navigator.share`-Aufruf wird vor dem ersten `await` ausgewertet, sodass die
 * transiente Aktivierung auf iOS Safari erhalten bleibt. Abbruch durch den
 * Nutzer ist kein Fehler (kein Toast, kein Download).
 */
export async function shareFile(file: File, title: string): Promise<void> {
  try {
    await navigator.share({ files: [file], title });
  } catch {
    // Abbruch durch den Nutzer ist kein Fehler.
  }
}

/**
 * Download-Fallback: lädt `url` über einen versteckten `<a download>` herunter.
 * Greift, wenn Datei-Sharing nicht verfügbar ist (z. B. Desktop).
 */
export function downloadFile(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
