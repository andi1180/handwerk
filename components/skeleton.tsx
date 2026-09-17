import type { CSSProperties, ReactNode } from "react";

/**
 * Geteilte Skeleton-Bausteine für die Instant-Loading-Anzeige (loading.tsx).
 *
 * Next.js zeigt eine `loading.tsx` SOFORT beim Klick, während die Server
 * Component im Hintergrund lädt (automatische Suspense-Boundary um page.tsx).
 * Diese Bausteine halten die Optik der sechs Portal-Platzhalter zusammen —
 * keine Duplikation der Puls-/Farb-Logik je Route.
 *
 * Reine Präsentation: Server-Component-fähig, kein State, kein Datenzugriff.
 * Die Optik (`.skeleton`, Puls, `prefers-reduced-motion`) sitzt in
 * [app/globals.css]; die Elemente sind `aria-hidden` — der Ladezustand wird
 * einmal am Wurzel-Container der jeweiligen `loading.tsx` über `aria-busy`
 * gemeldet, statt jeden Balken einzeln anzukündigen.
 */

type SkeletonBlockProps = {
  /** Breite (Zahl = px). Default: volle Breite des Containers. */
  width?: number | string;
  /** Höhe (Zahl = px). */
  height?: number | string;
  /** Eckenradius (Zahl = px). */
  radius?: number | string;
  style?: CSSProperties;
};

/** Rechteckiger Platzhalter — Grundbaustein (Kachel, Bild, Button, Balken). */
export function SkeletonBlock({
  width = "100%",
  height = 16,
  radius = 4,
  style,
}: SkeletonBlockProps) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** Textzeilen-Platzhalter — flacher als ein Block, für Fließtext/Labels. */
export function SkeletonLine({
  width = "100%",
  height = 13,
  style,
}: Omit<SkeletonBlockProps, "radius">) {
  return <SkeletonBlock width={width} height={height} radius={4} style={style} />;
}

/** Karten-Platzhalter in der bestehenden `.card`-Optik. */
export function SkeletonCard({
  children,
  gap = 10,
  style,
}: {
  children?: ReactNode;
  gap?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="card"
      style={{ display: "flex", flexDirection: "column", gap, ...style }}
    >
      {children}
    </div>
  );
}
