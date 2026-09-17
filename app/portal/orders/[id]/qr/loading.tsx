import { SkeletonBlock, SkeletonLine } from "@/components/skeleton";

/**
 * Instant-Loading für die QR-Druckansicht (`/portal/orders/[id]/qr`).
 * Erscheint sofort beim Klick, während [page.tsx] Auftrag + Booklet-Token lädt
 * und den QR-Code server-seitig erzeugt.
 *
 * Reine Anzeige: kein Datenzugriff, kein Client-JS.
 */
export default function QrLoading() {
  return (
    <div className="qr-page" aria-busy="true">
      <div className="qr-no-print qr-actions">
        <SkeletonBlock width={150} height={34} radius={6} />
        <SkeletonBlock width={110} height={34} radius={6} />
      </div>

      <div className="qr-card">
        <SkeletonLine width={170} height={16} />
        <SkeletonLine width={140} />
        <SkeletonBlock width={240} height={240} radius={6} />
        <SkeletonLine width={200} height={11} />
      </div>
    </div>
  );
}
