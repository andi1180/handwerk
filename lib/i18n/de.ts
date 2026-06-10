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
    orders: "Aufträge",
    logout: "Abmelden",
  },
  orders: {
    title: "Aufträge",
    new: "Neuer Auftrag",
    empty: "Noch keine Aufträge angelegt.",
    customerName: "Kundenname",
    email: "E-Mail",
    phone: "Telefon",
    externalRef: "Externe Referenz",
    externalRefHint: "z. B. roapp-Nr.",
    itemDescription: "Beschreibung",
    itemDescriptionHint: "Kontext für die KI — z. B. Material, Arbeitsschritte (optional).",
    consent: "Einwilligung des Kunden liegt vor",
    consentHint:
      "Der Kunde hat zugestimmt, dass seine Fotos und Angaben zur Erstellung des Booklets verwendet werden dürfen. Optional — der Auftrag kann auch ohne Einwilligung angelegt werden.",
    create: "Anlegen",
    nameRequired: "Bitte einen Kundennamen angeben.",
    createError:
      "Der Auftrag konnte nicht angelegt werden. Bitte erneut versuchen.",
  },
  orderStatus: {
    draft: "Entwurf",
    finalized: "Abgeschlossen",
    generated: "Generiert",
    sent: "Gesendet",
    viewed: "Angesehen",
    shared: "Geteilt",
  },
  orderDetail: {
    back: "Zurück zur Liste",
    media: "Medien",
    noMedia: "Noch keine Medien zu diesem Auftrag.",
  },
  mediaTag: {
    vorher: "Vorher",
    nachher: "Nachher",
    prozess: "Prozess",
  },
  capture: {
    photo: "Foto aufnehmen",
    keyword: "Stichwort",
    keywordOptional: "Stichwort (optional)",
    tag: "Markierung",
    tagOptional: "Markierung (optional)",
    save: "Speichern",
    discard: "Verwerfen",
    uploading: "lädt…",
    error: "Fehler",
    retry: "Erneut",
  },
} as const;
