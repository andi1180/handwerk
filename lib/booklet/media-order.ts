import type { MediaCategory } from "@/lib/orders/queries";

/**
 * Bringt die Medien eines Auftrags in die **feste Booklet-Reihenfolge** (0010):
 *
 *   before (Ausgangszustand) → process (in Eingangsreihenfolge) → after (Ergebnis)
 *
 * Die Eingabe wird als bereits nach `sort_order` ASC sortiert erwartet; innerhalb
 * der `process`-Gruppe bleibt diese Reihenfolge erhalten. `before`/`after` sind je
 * max 1 (App-enforced) — defensiv werden dennoch mehrere korrekt einsortiert
 * (alle before zuerst, alle after zuletzt). Alles, was weder before noch after ist
 * (insb. `process` und Videos), landet in der Mitte.
 *
 * EINE Quelle für den Web-Story-Render (`/b/[token]`) UND das Reel — so driften
 * sichtbare Story und Reel nie auseinander (analog `displayCaption`).
 */
export function orderBookletMedia<T extends { category: MediaCategory }>(
  media: readonly T[],
): T[] {
  const before: T[] = [];
  const middle: T[] = [];
  const after: T[] = [];
  for (const item of media) {
    if (item.category === "before") before.push(item);
    else if (item.category === "after") after.push(item);
    else middle.push(item);
  }
  return [...before, ...middle, ...after];
}
