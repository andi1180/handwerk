import { SkeletonBlock, SkeletonCard, SkeletonLine } from "@/components/skeleton";

/**
 * Instant-Loading für die Auftragsanlage (`/portal/orders/new`). Das Formular
 * selbst ist schnell da (Client-Komponente ohne Datenzugriff) — der Platzhalter
 * überbrückt nur die Navigation und hält die Anordnung stabil.
 *
 * Reine Anzeige: kein Datenzugriff, kein Client-JS.
 */
export default function NewOrderLoading() {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }} aria-busy="true">
      <SkeletonBlock
        width={200}
        height={24}
        radius={6}
        style={{ marginBottom: 20 }}
      />

      <SkeletonCard gap={16}>
        {[0, 1, 2, 3].map((field) => (
          <div
            key={field}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <SkeletonLine width={120} height={11} />
            <SkeletonBlock height={40} radius={6} />
          </div>
        ))}
        <SkeletonBlock height={44} radius={6} />
      </SkeletonCard>
    </div>
  );
}
