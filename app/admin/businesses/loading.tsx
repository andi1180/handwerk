import { SkeletonBlock, SkeletonCard, SkeletonLine } from "@/components/skeleton";

/**
 * Instant-Loading für die Admin-Betriebsliste (`/admin/businesses`). Grobe
 * Anordnung wie die echte Seite: Titel + Anzahl → Hinweis → Tabellen-Karte.
 *
 * Reine Anzeige: kein Datenzugriff, kein Client-JS.
 */
export default function AdminBusinessesLoading() {
  return (
    <div className="admin-page" aria-busy="true">
      <div className="admin-page-head">
        <SkeletonBlock width={120} height={26} radius={6} />
        <SkeletonLine width={70} />
      </div>
      <SkeletonLine width={420} height={12} style={{ marginBottom: 20 }} />

      <SkeletonCard gap={14}>
        <SkeletonLine height={12} />
        {[0, 1, 2, 3, 4].map((row) => (
          <SkeletonLine key={row} height={18} />
        ))}
      </SkeletonCard>
    </div>
  );
}
