/**
 * „Google" als farbiger Wortmarken-Schriftzug (G blau, o rot, o gelb, g blau,
 * l grün, e rot) — sofort als Google erkennbar, ohne das offizielle Logo-Asset
 * einzubetten (Markenrichtlinien). Rein dekorativ (`aria-hidden`); die
 * aufrufende Schaltfläche trägt das zugängliche Label.
 *
 * Geteilt vom Bewertungs-Popup (letzte Seite) und dem sticky Bewertungs-Button
 * (Medien-Seiten) — eine Quelle statt zweier Kopien.
 */
export function GoogleWordmark({ className }: { className?: string }) {
  const letters: [string, string][] = [
    ["G", "#4285F4"],
    ["o", "#EA4335"],
    ["o", "#FBBC05"],
    ["g", "#4285F4"],
    ["l", "#34A853"],
    ["e", "#EA4335"],
  ];
  return (
    <span
      className={className ? `booklet-google ${className}` : "booklet-google"}
      aria-hidden
    >
      {letters.map(([ch, color], i) => (
        <span key={i} style={{ color }}>
          {ch}
        </span>
      ))}
    </span>
  );
}
