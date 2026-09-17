import { SkeletonBlock, SkeletonCard, SkeletonLine } from "@/components/skeleton";

/**
 * Instant-Loading für das Dashboard (`/portal`). Next.js zeigt diese Datei
 * sofort beim Klick, während [page.tsx] serverseitig Funnel-, Event- und
 * Reichweiten-Daten lädt. Grobe Anordnung wie die echte Seite: Kopf →
 * Share-Rate-Headline → 2-Spalten-Raster → Reichweiten-Sektion.
 *
 * Reine Anzeige: kein Datenzugriff, kein Client-JS.
 */
export default function DashboardLoading() {
  return (
    <div className="dashboard" aria-busy="true">
      <div className="dashboard-head">
        <SkeletonBlock width={140} height={24} radius={6} />
      </div>

      {/* Headline: Share-Rate. */}
      <SkeletonCard
        gap={12}
        style={{ alignItems: "center", padding: "28px 24px" }}
      >
        <SkeletonBlock width={110} height={44} radius={8} />
        <SkeletonLine width={160} />
        <SkeletonLine width={220} height={11} />
        <div style={{ display: "flex", gap: 32, marginTop: 8 }}>
          <SkeletonBlock width={60} height={30} radius={6} />
          <SkeletonBlock width={60} height={30} radius={6} />
        </div>
      </SkeletonCard>

      {/* 2-Spalten-Raster: Funnel, Shares/Kanal, Klicks, Aufrufe. */}
      <div className="dashboard-grid" style={{ marginTop: 16 }}>
        {[0, 1, 2, 3].map((card) => (
          <SkeletonCard key={card} gap={14}>
            <SkeletonLine width={130} height={15} />
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <SkeletonLine width={90} />
                <SkeletonBlock
                  height={10}
                  radius={5}
                  style={{ flex: 1, minWidth: 0 }}
                />
              </div>
            ))}
          </SkeletonCard>
        ))}
      </div>

      {/* Reichweite / VIP-Analyse. */}
      <SkeletonCard gap={14} style={{ marginTop: 16 }}>
        <SkeletonLine width={200} height={15} />
        <SkeletonLine width={280} height={11} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <SkeletonBlock width={130} height={34} radius={6} />
          <SkeletonBlock width={130} height={34} radius={6} />
          <SkeletonBlock width={160} height={34} radius={6} />
        </div>
        {[0, 1, 2, 3, 4].map((row) => (
          <SkeletonLine key={row} height={18} />
        ))}
      </SkeletonCard>
    </div>
  );
}
