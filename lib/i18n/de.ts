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
    noAccount: "Noch kein Account?",
    register: "Jetzt registrieren",
  },
  register: {
    title: "Registrieren",
    intro:
      "Legen Sie Ihren Betrieb an. Wir schalten Ihren Zugang nach einer kurzen Prüfung frei.",
    businessName: "Betriebsname",
    email: "E-Mail",
    password: "Passwort",
    passwordRepeat: "Passwort wiederholen",
    submit: "Registrieren",
    submitting: "Wird gesendet…",
    fieldsRequired: "Bitte alle Felder ausfüllen.",
    emailInvalid: "Bitte eine gültige E-Mail-Adresse angeben.",
    passwordMin: "Das Passwort muss mindestens {min} Zeichen lang sein.",
    passwordMismatch: "Die Passwörter stimmen nicht überein.",
    emailTaken: "Diese E-Mail-Adresse ist bereits registriert.",
    error: "Registrierung fehlgeschlagen. Bitte erneut versuchen.",
    success:
      "Ihr Account wurde angelegt. Wir schalten ihn in Kürze frei und melden uns per E-Mail.",
    alreadyRegistered: "Bereits registriert?",
    loginLink: "Anmelden",
  },
  pending: {
    title: "Account wird freigeschaltet",
    message:
      "Ihr Account wird gerade geprüft. Sobald er freigeschaltet ist, melden wir uns per E-Mail — dann können Sie sich anmelden.",
  },
  portal: {
    welcome: "Willkommen, {name}",
    noBusiness:
      "Ihrem Konto ist noch kein Betrieb zugeordnet. Bitte wenden Sie sich an Ihren Administrator.",
  },
  nav: {
    dashboard: "Dashboard",
    orders: "Aufträge",
    settings: "Einstellungen",
    logout: "Abmelden",
    logoutConfirm: "Wirklich abmelden?",
  },
  orders: {
    title: "Aufträge",
    refresh: "Aktualisieren",
    new: "Neuer Auftrag",
    empty: "Noch keine Aufträge angelegt.",
    emptyFiltered: "Keine Aufträge für diese Auswahl.",
    filterLabel: "Status",
    filterAll: "Alle",
    filterQuickActive: "Schnellfilter aktiv",
    quickLabel: "Schnellfilter",
    quickFlagged: "Geflaggt",
    pagination: "Seiten-Navigation",
    prevPage: "Zurück",
    nextPage: "Weiter",
    pageOf: "Seite {page} von {total}",
    noDescription: "Keine Beschreibung",
    archive: "Archivieren",
    unarchive: "Aus Archiv holen",
    archiveMenu: "Archiv",
    archiveView: "Archiv",
    backToList: "← Hauptliste",
    archiveError: "Archivieren fehlgeschlagen. Bitte erneut versuchen.",
    emptyArchive: "Das Archiv ist leer.",
    select: "Auswählen",
    cancel: "Abbrechen",
    selected: "{n} ausgewählt",
    archiveSelected: "Archivieren",
    clearSelection: "Auswahl aufheben",
    confirmArchive: "{n} Aufträge archivieren?",
    archiveAllDone: "Alle erledigten archivieren",
    confirmArchiveAllDone: "Alle {n} erledigten archivieren?",
    noneToArchive: "Keine erledigten Aufträge zum Archivieren",
    selectAllFiltered: "Alle auswählen",
    allFilteredSelected: "Alle {n} ausgewählt",
    yes: "Ja",
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
    draft: "Neu",
    inProgress: "In Arbeit",
    sent: "Gesendet",
    viewed: "Angesehen",
    shared: "Geteilt",
    // generated → zusammengesetztes Render-Badge/Filter (aus booklets.reel_status):
    creating: "Wird erstellt …",
    ready: "Fertig",
    failed: "Fehler",
    pickupPendingNotice: "Abgeholt am {date} – Booklet nicht versendet",
  },
  orderDetail: {
    back: "Zurück zur Liste",
    media: "Medien",
    noMedia: "Noch keine Medien zu diesem Auftrag.",
  },
  contact: {
    edit: "Kontakt bearbeiten",
    save: "Speichern",
    saving: "Speichern …",
    cancel: "Abbrechen",
    invalidEmail: "Bitte eine gültige E-Mail-Adresse angeben.",
    saveError: "Speichern fehlgeschlagen. Bitte erneut versuchen.",
  },
  settings: {
    title: "Einstellungen",
    groupBusiness: "Betrieb",
    groupBranding: "Branding",
    groupCapture: "Aufnahme",
    groupLinks: "Online-Präsenz",
    groupDelivery: "Auslieferung",
    name: "Betriebsname",
    contactEmail: "Kontakt-E-Mail (für Antworten der Kunden)",
    contactEmailHint:
      "An diese Adresse antworten Kunden auf die Booklet-E-Mail. Sie darf von Ihrer Login-Adresse abweichen.",
    contactPhone: "Telefonnummer (öffentlich)",
    contactPhoneHint:
      "Wird im Booklet-Outro angezeigt, damit Kunden Sie direkt anrufen können (optional).",
    connectorRoapp: "roapp-Connector aktivieren",
    connectorRoappHint:
      "Aufträge werden automatisch aus roapp angelegt und ausgeliefert, sobald sie dort als „Abgeholt“ markiert sind. Bei aktivem Connector fragt der manuelle Versand zur Sicherheit nach.",
    primaryColor: "Primärfarbe",
    secondaryColor: "Sekundärfarbe",
    font: "Schriftart",
    logoPerPage: "Logo auf jeder Seite",
    videoMaxSeconds: "Maximale Videolänge (Sekunden)",
    videoMaxSecondsHint: "Standard {default} s, maximal {max} s.",
    photoMaxCount: "Max. Fotos pro Auftrag",
    photoMaxCountHint: "Standard {default}, maximal {max}.",
    videoMaxCount: "Max. Videos pro Auftrag",
    videoMaxCountHint: "Standard {default}, maximal {max}.",
    igHandle: "Instagram-Handle",
    igHandleHint: "z. B. @meinbetrieb (optional).",
    googleReviewUrl: "Google-Bewertungslink",
    websiteUrl: "Website",
    deliveryMode: "Auslieferungsmodus",
    deliveryManual: "Manuell",
    deliveryAuto: "Automatisch",
    retentionMonths: "Aufbewahrung (Monate)",
    retentionMonthsHint: "Zwischen {min} und {max} Monaten.",
    save: "Speichern",
    saved: "Gespeichert.",
    error: "Speichern fehlgeschlagen. Bitte erneut versuchen.",
    errName: "Bitte einen Betriebsnamen angeben.",
    errColor: "Bitte gültige Hex-Farben angeben (z. B. #C4A95B).",
    errVideo: "Die Videolänge muss zwischen {min} und {max} Sekunden liegen.",
    errRetention: "Die Aufbewahrung muss zwischen {min} und {max} Monaten liegen.",
    errPhotoCount: "Die Fotoanzahl muss zwischen {min} und {max} liegen.",
    errVideoCount: "Die Videoanzahl muss zwischen {min} und {max} liegen.",
    content: {
      sectionTitle: "Booklet-Inhalt",
      introTagline: "Intro-Claim",
      introTaglineHint:
        "Fester Claim unter dem KI-Titel auf der Intro-Seite (optional).",
      outroMessage: "Outro-Nachricht",
      emailInvalid: "Bitte eine gültige E-Mail-Adresse angeben.",
      tooLong: "Der Text ist zu lang.",
    },
    aiContext: {
      sectionTitle: "KI-Stil",
      label: "KI-Kontext",
      hint: "Erdet die KI-Texte (Intro): Fachsprache, Fokus und Ton. Kontext, keine Anweisung — keine erfundenen Fakten.",
      placeholder:
        "z. B. 'Meisterschneider, ändere v. a. Hosen. Beschreibe die Arbeitsschritte und die Sorgfalt bei der Qualität.'",
      tooLong: "Der KI-Kontext ist zu lang (max. 500 Zeichen).",
    },
    logo: {
      title: "Logo",
      upload: "Logo hochladen",
      uploading: "Lädt hoch…",
      remove: "Entfernen",
      removing: "Entferne…",
      preview: "Logo-Vorschau",
      error: "Logo konnte nicht gespeichert werden. Bitte erneut versuchen.",
      typeError: "Nur PNG, JPEG oder WebP sind erlaubt.",
      tooLarge: "Die Datei ist zu groß (max. 5 MB).",
    },
    background: {
      sectionTitle: "Hintergründe",
      intro: "Intro-Hintergrund",
      outro: "Outro-Hintergrund",
      upload: "Hintergrund hochladen",
      uploading: "Lädt hoch…",
      remove: "Entfernen",
      preview: "Hintergrund-Vorschau",
      previewHint: "Vorschau 9:16 — so wird zugeschnitten.",
      typeError: "Nur PNG, JPEG oder WebP sind erlaubt.",
      tooLarge: "Die Datei ist zu groß (max. 10 MB).",
      error: "Hintergrund konnte nicht gespeichert werden. Bitte erneut versuchen.",
    },
  },
  capture: {
    uploadPhoto: "Foto hochladen",
    uploadVideo: "Video hochladen",
    videoTooLong:
      "Das Video ist zu lang (max. {max} Sekunden). Bitte kürzer aufnehmen.",
    keywordOptional: "Stichwort (optional)",
    save: "Speichern",
    discard: "Aufnahme verwerfen",
    uploading: "lädt…",
    error: "Fehler",
    uploadError: "Upload fehlgeschlagen. Bitte erneut.",
    heicUnsupported:
      "Dieses Foto-Format (HEIC) kann auf diesem Gerät nicht verarbeitet werden. Tipp: iPhone-Einstellungen → Kamera → Formate → „Maximale Kompatibilität“ wählen, dann werden Fotos als JPEG gespeichert.",
    retry: "Erneut",
    limitReached: "Limit erreicht: max. {max} {type} pro Auftrag.",
    photosLabel: "Fotos",
    videosLabel: "Videos",
    // Bild-Kategorie im Aufnahme-Entwurf (0010) — nur Foto. Belegte Slots gesperrt.
    category: "Kategorie",
    categoryTaken: "belegt",
    categoryTakenNotice: "Für diese Kategorie gibt es bereits ein Bild.",
  },
  // Bild-Kategorien (0010): DB-Werte before/after/process → deutsche Labels.
  mediaCategory: {
    before: "Vorher",
    after: "Nachher",
    process: "Prozess",
  },
  assembler: {
    reorderHint: "Halten zum Verschieben",
    delete: "Löschen",
    deleteConfirm: "Dieses Medium wirklich löschen?",
    play: "Abspielen",
    close: "Schließen",
    reorderError: "Reihenfolge konnte nicht gespeichert werden.",
    deleteError: "Löschen fehlgeschlagen. Bitte erneut versuchen.",
    // Vorher/Nachher-Slots + Kategorie-Wechsel (0010).
    slotEmpty: "Noch kein Bild",
    // Leerer Slot ist im Editier-Modus tappbar → Foto-Upload für diese Kategorie.
    slotAdd: "{category}-Foto hinzufügen",
    slotAddHint: "Foto hinzufügen",
    // Prozess-„+"-Tile (Upload-Refactor): Tile-Label/aria + Foto/Video-Auswahl.
    addProcess: "Medium hinzufügen",
    chooseFoto: "Foto",
    chooseVideo: "Video",
    categoryLabel: "Kategorie",
    categoryError: "Kategorie konnte nicht geändert werden.",
    // Verifizier-Ansicht der extrahierten Video-Vorschau-Frames (Phase 1).
    videoFrames: "Erkannte Video-Bilder",
  },
  captions: {
    generate: "Captions generieren",
    generateSelected: "Auswahl beschriften ({count})",
    generating: "Generiere Captions…",
    regenerate: "Neu generieren",
    edit: "Bildunterschrift",
    save: "Speichern",
    saved: "Gespeichert",
    empty: "Keine Bildunterschrift",
    select: "Für Caption auswählen",
    selected: "{count} ausgewählt",
    selectAll: "Alle auswählen",
    deselectAll: "Auswahl aufheben",
    error: "Aktion fehlgeschlagen. Bitte erneut versuchen.",
    emptyResult: "Keine Bildunterschrift erzeugt – bitte manuell ergänzen.",
  },
  // „Bearbeiten" (Reopen, generated → draft) — zurück in den Editier-Modus.
  // Ersetzt den früheren `finalize`-Block (finalize ist entfallen; der eine
  // Schritt „Booklet erstellen" liegt unter `generate`).
  reopen: {
    button: "Bearbeiten",
    error: "Aktion fehlgeschlagen. Bitte erneut versuchen.",
  },
  generate: {
    // Der EINE Erstellen-Schritt: „Booklet erstellen" führt direkt
    // draft → generated aus (KI-Texte + Kunden-Link), keine Vorstufe.
    generate: "Booklet erstellen",
    // B2a: EIN kombinierter Schritt erzeugt Booklet UND Reel in einem Klick.
    combined: "Booklet & Reel erzeugen",
    generating: "Erstelle Booklet…",
    // Während der POST läuft (vor dem 202).
    waiting: "Bitte warten…",
    // Nach dem 202: der Render läuft serverseitig weiter — die Seite ist verlassbar.
    background: "Läuft im Hintergrund — diese Seite kann verlassen werden.",
    // Erledigter, grauer Zustand, sobald das Booklet existiert (Status generated).
    created: "Booklet erstellt",
    // B2a: Booklet + Reel stehen ⇒ „✓ Fertig".
    done: "Fertig",
    hint: "Erstellt die persönlichen Texte und den Kunden-Link. Jederzeit wieder änderbar.",
    needMedia: "Bitte zuerst mindestens ein Medium hinzufügen.",
    // 0010: nur Vorher/Nachher reicht nicht — mindestens ein Prozess-Medium nötig.
    needProcess: "Mindestens ein Prozess-Bild oder -Video nötig.",
    error: "Erzeugung fehlgeschlagen. Bitte erneut versuchen.",
    // B2a: reel_status='failed' ⇒ grober voller Neulauf (keine Diskriminierung).
    failed: "Erstellung fehlgeschlagen",
    retryFull: "Erneut erstellen",
    // B2b: Fehler-Diskriminierung über intro_title. Intro stand, nur das Reel
    // scheiterte ⇒ Retry NUR Reel (POST render-reel), kein neuer Sonnet-Call.
    reelRetry: "Reel erneut",
    reelFailed: "Reel fehlgeschlagen",
    timeout: "Zeitüberschreitung. Bitte erneut versuchen.",
    aiNotConfigured:
      "Die KI ist nicht konfiguriert. Bitte später erneut versuchen.",
    openPreview: "Booklet ansehen",
  },
  reel: {
    // Erledigter, grauer Zustand, sobald das Reel fertig gerendert ist
    // (reel_status='ready').
    created: "Reel erstellt",
    rendering: "Reel wird erstellt…",
    // Rotierende, rein kosmetische Fortschritts-Stufen während des Renders
    // (keine echte Telemetrie) — sequenziell an der Pipeline-Reihenfolge
    // orientiert; die letzte Stufe bleibt stehen, bis der Poll fertig meldet.
    stage1: "Auftrag wird vorbereitet…",
    stage2: "Medien werden geladen…",
    stage3: "Intro wird gestaltet…",
    stage4: "Logo wird platziert…",
    stage5: "Fotos werden aufbereitet…",
    stage6: "Bildunterschriften werden gesetzt…",
    stage7: "Video-Clips werden zugeschnitten…",
    stage8: "Clips werden ins Hochformat gebracht…",
    stage9: "Ton wird entfernt…",
    stage10: "Szenen werden aneinandergereiht…",
    stage11: "Outro wird angefügt…",
    stage12: "Reel wird zusammengefügt…",
    stage13: "Letzter Feinschliff…",
    stage14: "Fast fertig…",
    watch: "Reel ansehen",
    close: "Schließen",
    retry: "Erneut",
    hint: "Aus den Medien dieses Auftrags wird ein 9:16-Reel erstellt (Fotos je 3 s, Clips bis 6 s, harte Schnitte, ohne Ton).",
    needMedia: "Bitte zuerst mindestens ein Medium (Foto oder Video) hinzufügen.",
    failed: "Reel-Erstellung fehlgeschlagen. Bitte erneut versuchen.",
    error: "Aktion fehlgeschlagen. Bitte erneut versuchen.",
  },
  deliver: {
    button: "Booklet ausliefern",
    delivering: "Liefere aus…",
    confirm: "Booklet jetzt ausliefern?",
    confirmText: "Der Kunde erhält den Link zum Booklet per E-Mail.",
    confirmTextSms: "Der Kunde erhält den Link zum Booklet per SMS.",
    connectorActive:
      "Der roapp-Connector ist aktiv — die Auslieferung erfolgt normalerweise automatisch, sobald der Auftrag in roapp als „Abgeholt“ markiert wird. Trotzdem jetzt manuell senden?",
    reelNotReady: "Das Reel ist noch nicht fertig. Trotzdem ausliefern?",
    noContact:
      "Weder E-Mail noch Telefonnummer hinterlegt — der Kunde erhält keinen Link. Drucke den QR-Code, um das Booklet zu übergeben.",
    delivered: "Ausgeliefert am {date}",
    deliveredNoDate: "Ausgeliefert",
    sentEmail: "Booklet per E-Mail an den Kunden gesendet.",
    sentSms: "Booklet per SMS an den Kunden gesendet.",
    noContactSent:
      "Der Auftrag ist als ausgeliefert markiert, aber es ist weder E-Mail noch Telefonnummer hinterlegt. Bitte den QR-Code drucken und dem Kunden geben.",
    sendFailed:
      "Versand fehlgeschlagen: {reason}. Der Auftrag gilt trotzdem als ausgeliefert.",
    timeout: "Zeitüberschreitung. Bitte erneut versuchen.",
    error: "Auslieferung fehlgeschlagen. Bitte erneut versuchen.",
  },
  booklet: {
    scrollHint: "Nach unten wischen",
    // Zurück zur Auftrags-Detailseite — NUR in der betriebs-eigenen Vorschau
    // (`?p=1`) gerendert, nie für den echten Kunden (Sackgassen-Fix).
    backToOrder: "Zurück zum Auftrag",
    contactEmail: "E-Mail",
    contactPhone: "Telefon",
    contactWebsite: "Website",
    expiredTitle: "Diese Seite ist nicht mehr verfügbar.",
    expiredText: "Der Link ist abgelaufen.",
  },
  share: {
    heading: "Gefällt's dir? Teile es!",
    // Button 1 (PRIMÄR): Story-URL teilen, Fallback = Link kopieren.
    shareBooklet: "Booklet teilen",
    // Button 2: Reel als Datei → IG/TikTok-Composer (Fallback = Download).
    shareReel: "Als Insta/TikTok-Story teilen",
    download: "Reel herunterladen",
    copied: "✓ Link kopiert",
    sharing: "Wird vorbereitet…",
    // Titel/Text für navigator.share (Kunden-Perspektive).
    shareTitle: "Mein Booklet",
    // Fester, schlichter Teilen-Text (kein dynamischer Kontext) — neugierig
    // machend, nicht spammy. Sprache = Booklet-Sprache.
    message: "Ein kleines Booklet zu meiner Maßarbeit – schau mal rein",
  },
  review: {
    // §8.6-PFLICHT: Vorschlag-Charakter („Textvorschlag (KI)") — der Kunde fügt
    // ihn ins Google-Feld ein und kann ihn dort frei anpassen; NIEMALS an eine
    // Belohnung gekoppelt, keine Sterne-Vorgabe (harter Google-ToS-Verstoß).
    // „Google" trägt im Button der farbige Wortmarken-Schriftzug, daher hier ohne.
    button: "Bewertung schreiben",
    hint: "Textvorschlag (KI) im Clipboard abgelegt - bei Google ins Textfeld tippen und einfügen/paste wählen.",
    copied: "✓ Entwurf kopiert",
  },
  qr: {
    // QR-Druckansicht (9c-2): Handover am Tresen. Der QR kodiert den
    // Kunden-Booklet-Link (?c=1). Bon-Drucker-tauglich, S/W.
    printButton: "QR drucken",
    forCustomer: "Für {name}",
    hint: "Scannen Sie den Code für Ihr persönliches Booklet",
    // Zurück zur Auftrags-Detailseite (Sackgassen-Fix; nur Bildschirm, nicht Druck).
    back: "Zurück zum Auftrag",
  },
  dashboard: {
    // Analytics-Dashboard auf der Startseite (Schritt 10b).
    title: "Dashboard",
    shareRate: "Teil-Rate",
    shareRateHint:
      "Anteil der ausgelieferten Booklets, die geteilt wurden — die Kernkennzahl.",
    funnel: "Verlauf",
    delivered: "Ausgeliefert",
    viewed: "Angesehen",
    shared: "Geteilt",
    sharesByChannel: "Teilungen nach Kanal",
    clicks: "Klicks",
    // Kanal-Labels (spiegeln die Event-Channels aus lib/booklet/events.ts).
    reel: "Reel",
    story: "Story",
    whatsapp: "WhatsApp",
    copy: "Link kopiert",
    website: "Website",
    review: "Bewertung",
    ig: "Instagram",
    views: "Aufrufe",
    uniqueViews: "Eindeutige Aufrufe",
    totalViews: "Aufrufe gesamt",
    empty:
      "Noch keine Daten. Sobald Booklets ausgeliefert und angesehen werden, erscheinen hier die Kennzahlen.",
  },
  businessReel: {
    create: "Betriebs-Reel",
    rendering: "Wird erstellt …",
    ready: "Reel fertig",
    retry: "Neu erstellen",
    gateMissing: "Vorher/Nachher fehlt",
    // 3c: Teilen-Popup (Zustand 2/3).
    share: "Reel teilen",
    reshare: "Erneut teilen",
    shareTitle: "Atelier Reel",
    preparing: "Wird vorbereitet …",
    loadError: "Laden fehlgeschlagen",
    shareNow: "Jetzt teilen",
    download: "Reel herunterladen",
  },
  reach: {
    // Reichweiten-/VIP-Analyse-Sektion auf dem Dashboard.
    title: "Reichweite / VIP-Analyse",
    hint: "Pro Kunde: Reichweite (eindeutige Aufrufe), Gesamt-Öffnungen und Teilen-Aktivitäten der ausgelieferten Booklets. Zeitraum optional einschränken.",
    export: "Als CSV exportieren",
    empty: "Noch keine ausgelieferten Booklets.",
    // Filter-Leiste.
    from: "Von",
    to: "Bis",
    sort: "Sortierung",
    sortReach: "Reichweite",
    sortOpens: "Öffnungen",
    sortShares: "Teilen",
    sortSent: "Versanddatum",
    sortName: "Name (A–Z)",
    // Tabellen-Spalten (kompakt; der CSV-Export nutzt ausführlichere Header).
    colCustomer: "Kundenname",
    colEmail: "E-Mail/SMS",
    colRef: "roapp-Nr.",
    colDescription: "Beschreibung",
    colSentAt: "Versanddatum",
    colReach: "Reichweite",
    colOpens: "Öffnungen",
    colShares: "Teilen",
  },
} as const;
