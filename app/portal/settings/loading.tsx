import { SkeletonBlock, SkeletonCard, SkeletonLine } from "@/components/skeleton";

/**
 * Instant-Loading für die Einstellungen (`/portal/settings`). Erscheint sofort
 * beim Klick, während [page.tsx] den Betrieb lädt und Logo-/Hintergrund-
 * Vorschauen signiert. Spiegelt die Karten-Gruppen der echten Form.
 *
 * Reine Anzeige: kein Datenzugriff, kein Client-JS.
 */
export default function SettingsLoading() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }} aria-busy="true">
      <SkeletonBlock
        width={160}
        height={24}
        radius={6}
        style={{ marginBottom: 20 }}
      />

      {[0, 1, 2, 3].map((group) => (
        <SkeletonCard key={group} gap={16} style={{ marginBottom: 20 }}>
          <SkeletonLine width={140} height={15} />
          {[0, 1].map((field) => (
            <div
              key={field}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <SkeletonLine width={110} height={11} />
              <SkeletonBlock height={40} radius={6} />
            </div>
          ))}
        </SkeletonCard>
      ))}
    </div>
  );
}
