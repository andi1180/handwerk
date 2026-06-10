/**
 * Deutsches Dictionary — kanonische Form aller Übersetzungen.
 * Die Struktur dieses Objekts definiert den Typ `Dictionary` (siehe index.ts);
 * jede weitere Sprache muss dieselbe Form erfüllen.
 */
export const de = {
  app: {
    name: "Valooro Handwerk",
  },
  login: {
    title: "Anmelden",
    email: "E-Mail",
    password: "Passwort",
    submit: "Anmelden",
    error: "Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.",
  },
  portal: {
    welcome: "Willkommen, {name}",
    noBusiness:
      "Ihrem Konto ist noch kein Betrieb zugeordnet. Bitte wenden Sie sich an Ihren Administrator.",
  },
  nav: {
    dashboard: "Dashboard",
    logout: "Abmelden",
  },
} as const;
