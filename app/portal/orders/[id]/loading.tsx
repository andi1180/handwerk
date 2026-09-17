import { SkeletonBlock, SkeletonCard, SkeletonLine } from "@/components/skeleton";

/**
 * Instant-Loading für die Auftrags-Detailseite (`/portal/orders/[id]`).
 * Erscheint sofort beim Klick, während [page.tsx] Auftrag, Medien + signierte
 * URLs lädt. Spiegelt die echte Anordnung: sticky Kopf → Stammdaten-Karte →
 * Vorher/Nachher-Slots + Prozess-Raster.
 *
 * Reine Anzeige: kein Datenzugriff, kein Client-JS.
 */
export default function OrderDetailLoading() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }} aria-busy="true">
      {/* Kopf: Zurück-Link, Kundenname, Status-Badge. */}
      <div className="order-detail-head">
        <SkeletonLine width={110} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 10,
          }}
        >
          <SkeletonBlock width="50%" height={22} radius={6} />
          <SkeletonBlock
            width={84}
            height={24}
            radius={12}
            style={{ flexShrink: 0 }}
          />
        </div>
      </div>

      {/* Stammdaten. */}
      <SkeletonCard gap={12} style={{ marginBottom: 24 }}>
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <SkeletonLine width={90} height={11} />
            <SkeletonLine width="70%" />
          </div>
        ))}
      </SkeletonCard>

      {/* Vorher/Nachher-Slots. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {[0, 1].map((slot) => (
          <SkeletonBlock
            key={slot}
            height="auto"
            radius={6}
            style={{ aspectRatio: "1 / 1" }}
          />
        ))}
      </div>

      {/* Prozess-Raster. */}
      <SkeletonLine width={100} height={15} style={{ marginBottom: 10 }} />
      <div className="media-grid">
        {[0, 1, 2, 3].map((tile) => (
          <SkeletonBlock
            key={tile}
            height="auto"
            radius={6}
            style={{ aspectRatio: "1 / 1" }}
          />
        ))}
      </div>
    </div>
  );
}
