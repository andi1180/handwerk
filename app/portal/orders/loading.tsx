import { SkeletonBlock, SkeletonCard, SkeletonLine } from "@/components/skeleton";

/**
 * Instant-Loading für die Auftragsliste (`/portal/orders`). Erscheint sofort
 * beim Klick, während [page.tsx] Aufträge + Booklet-/Gate-Zweitqueries lädt.
 * Spiegelt die echte Anordnung: Titelzeile → Suche/Filter/„Neuer Auftrag" →
 * Kachelliste.
 *
 * Reine Anzeige: kein Datenzugriff, kein Client-JS.
 */
export default function OrdersLoading() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }} aria-busy="true">
      <div className="orders-header">
        <div className="orders-title-row">
          <SkeletonBlock width={130} height={24} radius={6} />
          <div style={{ display: "flex", gap: 8 }}>
            <SkeletonBlock width={40} height={40} radius={20} />
            <SkeletonBlock width={96} height={34} radius={6} />
          </div>
        </div>
        <SkeletonBlock height={40} radius={6} />
        <SkeletonBlock height={38} radius={6} />
        <SkeletonBlock height={40} radius={6} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <SkeletonCard key={row} gap={8}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <SkeletonLine width="55%" height={15} />
                <SkeletonLine width="75%" />
                <SkeletonLine width={90} height={11} />
              </div>
              <SkeletonBlock
                width={84}
                height={24}
                radius={12}
                style={{ flexShrink: 0 }}
              />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
