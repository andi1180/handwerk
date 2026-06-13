# FLOW_REDESIGN — Booklet-Erstellungs-Flow vereinfachen

Analyse + Design-Konzept (kein Code geändert). Grundlage: vollständige Lektüre von
[page.tsx](app/portal/orders/[id]/page.tsx), [finalize-controls.tsx](app/portal/orders/[id]/finalize-controls.tsx),
[generate-controls.tsx](app/portal/orders/[id]/generate-controls.tsx), [deliver-controls.tsx](app/portal/orders/[id]/deliver-controls.tsx),
[capture.tsx](app/portal/orders/[id]/capture.tsx), [media-list.tsx](app/portal/orders/[id]/media-list.tsx) sowie der Route Handler
[finalize](app/api/portal/orders/[id]/finalize/route.ts), [reopen](app/api/portal/orders/[id]/reopen/route.ts),
[generate](app/api/portal/orders/[id]/generate/route.ts), [render-reel](app/api/portal/orders/[id]/render-reel/route.ts),
[reel-status](app/api/portal/orders/[id]/reel-status/route.ts), [deliver](app/api/portal/orders/[id]/deliver/route.ts)
und der Status-Maschine aus Migration 0001 (`draft → finalized → generated → sent → viewed → shared`).

---

## TEIL 1 — IST-Analyse

### 1.1 Der Flow heute, Schritt für Schritt

Was die Detailseite vom Nutzer verlangt, in der Reihenfolge, in der er es erlebt:

| # | Nutzeraktion (UI-Label) | API-Call | Status-Übergang | Was wird wirklich erzeugt/gespeichert | Technisch notwendig? |
|---|---|---|---|---|---|
| 1 | Fotos/Videos aufnehmen oder hochladen (4 Buttons in 2 Reihen) | Storage-Upload + `POST …/media` | — (bleibt `draft`) | `order_media`-Rows + Dateien im Bucket | **Ja** — Rohmaterial |
| 2 | optional: Kacheln auswählen → „Captions generieren" | `POST …/captions` | — | `order_media.caption` (Haiku) | Optional — fließt aber als Kontext ins Intro (1.2) |
| 3 | **„Booklet abschließen"** (gold, Seitenende) + `window.confirm` | `POST …/finalize` | `draft → finalized` | **Nichts außer dem Status.** Kein Insert, kein Artefakt, kein KI-Call. Einziger Effekt: Editier-Modus aus (Capture weg, MediaList read-only). | **Als eigener Nutzer-Schritt: Nein** (s. 1.3) |
| 4 | Seite rendert neu: Banner „Booklet abgeschlossen" **oben**, neuer Gold-Button **„Vorschau erzeugen"** **unten** | — | — | — | UX-Artefakt |
| 5 | **„Vorschau erzeugen"** (gold, Seitenende) | `POST …/generate` | `finalized → generated` | **Das eigentliche Booklet**: `booklets`-Row mit KI-Intro (Sonnet, Titel + Anrede-Absatz), Review-Entwurf (Sonnet, non-fatal), IG-Caption (Template), `access_token`, `short_code`, `web_story_ready=true` | **Ja** — ohne diesen Schritt existiert weder `/b/[token]` noch ein Link, nichts ist auslieferbar |
| 6 | Seite rendert neu: Banner „Booklet generiert" **oben** mit „Vorschau öffnen" (gold) + „Neu generieren" + „Wieder bearbeiten"; darunter „QR drucken"-Link | — | — | — | Inhaltlich nötig, Platzierung das Kernproblem |
| 7 | „Vorschau öffnen" (im oberen Banner) | — (Link `/b/[token]?c=1&p=1`) | — | — | Ansehen ist nötig; **es ist keine „Vorschau", sondern das echte Kunden-Booklet** mit No-Track-Marker |
| 8 | **„Reel erstellen"** (gold, Seitenende, unter dem Medien-Raster) | `POST …/render-reel` (202) + Poll `GET …/reel-status` | — (**Order-Status unberührt**, nur `booklets.reel_status`) | `reel.mp4` im Storage + `reel_url`/`reel_status` | Optional per Design (Opt-in = Kostenkontrolle), Platz unten vom Nutzer gewollt |
| 9 | **„Booklet ausliefern"** (Seitenende, unter dem Reel) + mehrzeiliger `window.confirm` | `POST …/deliver` | `generated → sent` (count-Guard gegen Doppelversand) | `booklets.sent_at`, Billing-Event `booklet_sent`, Kunden-E-Mail (Resend, non-blocking), `picked_up_at=null` | **Ja** — finale Aktion, Platz unten vom Nutzer bestätigt |

Parallel existiert der roapp-Pfad: der Webhook liefert bei „Abgeholt" **nur** aus, wenn der
Auftrag bereits `generated` ist; bei `draft`/`finalized` setzt er stattdessen das Warn-Flag
`picked_up_at` („Abgeholt, Booklet nicht versendet"). **`draft` und `finalized` sind für den
Connector identisch wertlos** — erst `generated` zählt.

### 1.2 Antwort auf die Kern-Frage: Was tut „Vorschau erzeugen" wirklich?

**Es erzeugt das Booklet. Es ist keine Vorschau-Funktion.** Aus [generate/route.ts](app/api/portal/orders/[id]/generate/route.ts):

- Sonnet-Call 1: `generateIntro` → `intro_title` + `intro_description` (persönliche Anrede, fatal bei Fehler ⇒ 502).
- Sonnet-Call 2: `generateReviewDraft` → `review_draft` (non-fatal).
- Template: `buildIgCaption` → `ig_caption`.
- Insert/Update der `booklets`-Row: `access_token` (24 Byte, der einzige Zugriffsschutz des Kunden-Links), `short_code` (Kurzlink `/s/<code>`), `web_story_ready=true`.
- Order-Status → `generated`.

Die öffentliche Seite `/b/[token]` ist ein **reiner Renderer** dieser gespeicherten Daten (KI-frei,
signiert nur frisch). Der „Vorschau öffnen"-Button öffnet **genau das Booklet, das der Kunde
bekommt** (nur mit `?c=1&p=1`-Markern für Kunden-Sicht + No-Track).

**Konsequenz:** Der Schritt ist technisch zwingend und bleibt — er ist nur **falsch benannt und
falsch eingeordnet**. „Vorschau erzeugen" klingt nach einem optionalen Zwischenartefakt; tatsächlich
ist es der Bau-Schritt des Produkts. Redundant ist nicht dieser Schritt, sondern der **separate
Abschluss-Schritt davor**.

### 1.3 Warum es zwei Buttons gibt (und warum nur einer nötig ist)

[finalize/route.ts](app/api/portal/orders/[id]/finalize/route.ts) schreibt **ausschließlich**
`status='finalized'` (plus Guards: `draft`, ≥ 1 Medium). Kein Artefakt, kein KI-Call, kein Insert.
Seine zwei Funktionen sind:

1. **Editier-Sperre** — die liefert `generated` aber genauso (MediaList read-only ab „nicht draft").
2. **Gate für `generate`** — die Generate-Route verlangt `finalized | generated`.

Beides rechtfertigt einen **DB-Zustand**, aber keinen **eigenen Nutzer-Schritt**. Die Historie
bestätigt das: TECH.md (Schritt 6c) plante wörtlich *„der Generierungs-Hook hängt sich später an den
Finalize-Übergang"* — Schritt 8a-1 hat den Hook dann aber als **zweiten Button** daneben gebaut
statt an den Übergang gehängt. Der Zwei-Schritt-Flow ist ein Artefakt der inkrementellen
Bauschritte, kein Design.

Niemand profitiert vom Verweilen in `finalized`: der Webhook behandelt es wie `draft`
(Pickup-Flag statt Auto-Versand), das Reel ist dort nicht renderbar, der Quick-Filter
„Nicht generiert" fasst `draft`+`finalized` ohnehin zusammen. Der Zustand ist nur als
**technischer Zwischen-/Fehlerzustand** sinnvoll (Generate nach Finalize fehlgeschlagen ⇒ 502,
Order parkt in `finalized` — diesen Recovery-Fall muss auch das Redesign abbilden).

### 1.4 Die konkreten UX-Defekte (am Code festgemacht)

1. **Doppelschritt mit Begriffs-Drift:** „Booklet abschließen" → confirm → neue Seite → „Vorschau
   erzeugen". Zwei Gold-Buttons nacheinander an derselben Stelle, die für den Nutzer dasselbe
   meinen („mach das Booklet fertig"). Der Confirm-Text widerspricht sich zudem selbst
   („Danach sind keine Änderungen mehr möglich. Du kannst es jederzeit wieder … öffnen.").
2. **Aktionen springen nach oben:** Der Nutzer klickt unten „Vorschau erzeugen"; nach
   `router.refresh()` landen die Folge-Aktionen („Vorschau öffnen", „Neu generieren", „Wieder
   bearbeiten") im **Banner am Seitenkopf** ([page.tsx](app/portal/orders/[id]/page.tsx) rendert
   `GeneratedBanner` direkt unter dem Sticky-Head), während Reel + Ausliefern **unten** bleiben.
   Ergebnis: Hochscrollen zum Ansehen, Runterscrollen zum Ausliefern — exakt die Kritik des Nutzers.
3. **Drei Begriffe für eine Sache:** „abschließen" / „generieren" / „Vorschau" für den einen
   Vorgang „Booklet erstellen". Dazu „Vorschau öffnen" für das **echte** Booklet.
4. **Banner-Inflation oben:** Sticky-Head zeigt bereits den Status-Badge; darunter wiederholt je ein
   Banner (`FinalizeBanner`/`GeneratedBanner`/`DeliveredBanner`) dieselbe Information und schiebt
   Stammdaten + Medien nach unten (mehr Scrollen auf Mobile).
5. **Lücke bei `viewed`/`shared`:** [page.tsx](app/portal/orders/[id]/page.tsx) rendert Banner, QR-Link
   und Vorschau-Link nur für `generated`/`sent`. Bei `viewed`/`shared` bleibt **nur** der ReelButton —
   kein „Booklet ansehen", kein QR, obwohl `bookletToken` für diese Status sogar geladen wird.
6. **Confirm-Müdigkeit:** `window.confirm` bei Abschließen **und** Ausliefern (dort bis zu drei
   Absätze). Der erste Confirm sichert einen vollständig reversiblen Schritt ab.
7. **Reel-Staleness unsichtbar:** „Neu generieren" überschreibt die Intro-Texte, das fertige Reel
   behält den **alten** eingebrannten Titel. Kein Hinweis im UI.

---

## TEIL 2 — Design-Konzept

### Leitidee

**Ein Bau-Schritt, eine Aktionszone.** Aus Nutzersicht gibt es genau drei Dinge:
**Medien sammeln → Booklet erstellen → ausliefern** (plus optional Reel). Alle Aktionen leben in
**einer zusammenhängenden Aktionszone am Seitenende** — dort, wo der Nutzer zuletzt geklickt hat,
erscheinen nach dem Refresh die Folge-Aktionen. Oben bleibt nur der Sticky-Head mit Status-Badge.
Die Status-Maschine bleibt **unverändert** — `finalized` wird zum unsichtbaren Durchgangs- bzw.
Recovery-Zustand.

### (a) Soll-Flow aus Nutzersicht

1. **Medien sammeln** (`draft`) — wie heute: Capture, Raster, Reorder, Captions. Am Seitenende
   **ein** großer Gold-Button **„Booklet erstellen"**. Darunter ein Satz Klartext: *„Erstellt die
   persönlichen Texte und den Kunden-Link. Du kannst danach jederzeit wieder ändern."* Plus dezenter
   Tipp: *„Captions zuerst — sie fließen in die Texte ein."* **Kein `window.confirm`** (der Schritt
   ist per Reopen voll reversibel; die bewusste Geste ist der Tap selbst).
2. **„Booklet erstellen"** führt technisch beide Übergänge aus (finalize → generate, s. (b));
   der Button zeigt währenddessen Stufen-Text („Schließe ab… / Erstelle Texte…", analog
   Reel-Ticker). Nach Erfolg rendert die Seite neu — und an **derselben Stelle** steht jetzt:
3. **Booklet-Karte** (`generated`): „✓ Booklet fertig" mit **„Booklet ansehen"** (gold, öffnet
   `/b/[token]?c=1&p=1`) und **„Ändern"** (= Reopen → zurück zu 1; erneutes „Booklet erstellen"
   regeneriert die Texte, Token + Kurzlink bleiben). Tertiär in derselben Karte: „Texte neu
   erzeugen" (heutiges „Neu generieren", für den Fall „Medien ok, Text gefällt nicht").
4. **Reel-Block** direkt darunter — **groß**, wie vom Nutzer gewünscht: „Reel erstellen" /
   Fortschritts-Ticker / „Reel ansehen" + „Neu erstellen". Unverändert Opt-in (Kostenkontrolle).
5. **Auslieferungs-Block** als Abschluss der Zone: **„Booklet ausliefern"** (mit dem bestehenden
   Confirm inkl. Connector-Safe-Mode-, Reel- und E-Mail-Warnung — der bleibt, denn Versand ist
   irreversibel und extern wirksam) + daneben **„QR drucken"** (gehört semantisch zur Übergabe am
   Tresen, nicht in den Seitenkopf).
6. **Nach dem Versand** (`sent`/`viewed`/`shared`): dieselbe Zone zeigt die Versand-Karte
   („Ausgeliefert am {Datum}" / „Vom Kunden geöffnet" / „Vom Kunden geteilt") mit „Booklet ansehen"
   + „QR drucken" — **für alle drei Status** (schließt Defekt 5). Der Reel-Block erscheint hier nur,
   wenn das Reel fehlt/fehlgeschlagen ist (Nachträglich-Rendern, FIX 7.1), mit dem Hinweis *„erscheint
   im bestehenden Kunden-Link — es wird nichts erneut versendet"*.
7. **Recovery-Zustand** (`finalized`, nur sichtbar wenn Schritt 2 zwischen den beiden Calls
   scheiterte): dieselbe Zone zeigt den Fehlerhinweis + **„Booklet erstellen"** als Retry (ruft dann
   nur noch generate — der Status passt bereits) + „Ändern" (Reopen). Kein eigenes Banner, kein
   eigener Begriff — für den Nutzer ist es derselbe Button wie in Schritt 1.

Begriffs-Hygiene (i18n, zentral in `de.ts`): **„Booklet erstellen"** (statt abschließen/Vorschau
erzeugen), **„Booklet ansehen"** (statt Vorschau öffnen), **„Ändern"** (statt Wieder bearbeiten),
„Reel erstellen" und „Booklet ausliefern" bleiben.

### (b) Komponenten/Routes — bleibt / ändert sich / entfällt (Konzept-Ebene)

**Routes: alle unverändert.** Empfehlung: **Client-Chaining statt neuem Endpoint** — der
„Booklet erstellen"-Handler ruft bei `draft` sequenziell `POST finalize`, dann `POST generate`
(bei `finalized` nur `generate`). Vorteile: null Backend-Änderung, alle Guards/Isolationsregeln
(401/403/404/409, `need_media`, business_id aus Session) bleiben exakt wie reviewt; der
Zwischenzustand `finalized` ist der natürliche Retry-Punkt. Ein kombinierter Endpoint
(`POST create-booklet`) wäre atomarer, dupliziert aber Guards und ist erst sinnvoll, wenn das
Chaining in der Praxis hakt — als spätere Option notiert, nicht jetzt.

| Baustein | Schicksal |
|---|---|
| `finalize`/`reopen`/`generate`/`render-reel`/`reel-status`/`deliver` Routes | **bleiben unverändert** |
| `FinalizeButton` + `GenerateButton` | **verschmelzen** zu einem „Booklet erstellen"-Control (status-bewusst: draft ⇒ finalize+generate, finalized ⇒ nur generate) |
| `FinalizeBanner` (oben) | **entfällt** (Zustand `finalized` wird in der Aktionszone als Retry/„Ändern" abgebildet) |
| `GeneratedBanner` (oben) | **entfällt als Banner**; Inhalt (Ansehen/Texte neu/Ändern) wandert als Booklet-Karte **in die Aktionszone unten** |
| `DeliveredBanner` (oben) | **wandert nach unten** in die Aktionszone, erweitert auf `viewed`/`shared` |
| „QR drucken"-Link (oben) | **wandert in den Auslieferungs-Block** der Aktionszone |
| `ReelButton` | bleibt, Platz unverändert unten, optisch größer (capture-btn-Muster), + statischer Staleness-Hinweis (s. (d)) |
| `DeliverButton` inkl. Confirm/Connector-Logik | bleibt unverändert, nur Position innerhalb der Zone |
| `page.tsx` | rendert statt 3 Top-Banner + 4 verstreuter Bottom-Blöcke **eine** `<BookletActions>`-Zone nach der Medien-Sektion |
| Capture/MediaList/Stammdaten/Sticky-Head | unverändert |
| i18n | Umbenennungen wie oben; `finalize.confirm*` entfällt |

Optionale Politur (separat entscheidbar, nicht Teil des Kerns): kompakter 3-Stufen-Indikator im/unter
dem Sticky-Head („Medien · Booklet · Versand") als Orientierung — bewusst ohne Reel-Stufe (optional)
und nur, wenn er eine Zeile bleibt.

### (c) Layout-Skizze der Detailseite je Status

```
IMMER:  ┌ Sticky-Head: ← Aufträge | Kundenname            [Status-Badge] ┐
        │ Stammdaten-Karte                                               │
        │ Medien: Capture (nur draft) + Kachel-Raster (+Caption-Aktionen)│
        └──────────────────────── danach die EINE Aktionszone: ──────────┘

draft:                          finalized (nur Recovery):
┌─ AKTIONSZONE ───────────────┐ ┌─ AKTIONSZONE ───────────────┐
│ ████ Booklet erstellen ████ │ │ ⚠ Texte konnten nicht       │
│ Erstellt Texte + Kunden-    │ │   erstellt werden.          │
│ Link. Jederzeit änderbar.   │ │ ████ Booklet erstellen ████ │
│ Tipp: Captions zuerst.      │ │ [Ändern]                    │
└─────────────────────────────┘ └─────────────────────────────┘

generated:                      sent / viewed / shared:
┌─ AKTIONSZONE ───────────────┐ ┌─ AKTIONSZONE ───────────────┐
│ ✓ Booklet fertig            │ │ ✓ Ausgeliefert am 12.06.    │
│ [Booklet ansehen]  [Ändern] │ │   (bzw. geöffnet/geteilt)   │
│  Texte neu erzeugen (klein) │ │ [Booklet ansehen] [QR druck.]│
├─ Reel ──────────────────────┤ ├─ Reel (nur wenn fehlt/fail) ┤
│ ████ Reel erstellen ████    │ │ ████ Reel erstellen ████    │
│ Ticker / [Reel ansehen]     │ │ „erscheint im bestehenden   │
│         [Neu erstellen]     │ │  Link, kein Neu-Versand"    │
├─ Auslieferung ──────────────┤ └─────────────────────────────┘
│ ████ Booklet ausliefern ████│
│ [QR drucken]                │
└─────────────────────────────┘
```

Der Nutzer scrollt nie zwischen „oben ansehen" und „unten weitermachen": nach jedem Klick erscheint
die Folgeaktion an derselben Stelle (nach `router.refresh()` bleibt die Scroll-Position am Zonenende).

### (d) Risiken, Trade-offs, und was beim Umbau NICHT brechen darf

**Trade-offs (bewusst eingegangen):**

- **Kein Park-Zustand „abgeschlossen, aber ohne KI-Kosten" mehr.** Heute könnte man finalizen und
  warten; das entfällt sichtbar. Bewertung: kein realer Verlust — `draft` parkt genauso, und im
  roapp-Betrieb ist Verweilen in `finalized` eine Falle (Pickup-Flag statt Auto-Versand). Die
  KI-Kosten des Erstellens (2 Sonnet-Calls) trägt jetzt ein einziger bewusster Tap ohne Confirm;
  das Reel (der teure Render) bleibt separat Opt-in.
- **Chaining statt Atomarität:** Zwischen finalize und generate kann der zweite Call scheitern
  (Sonnet 502/Timeout). Das ist heute schon der Fall (gleicher 502), nur sichtbar als eigener
  Screen; im Redesign fängt der Recovery-Zustand (c, `finalized`) ihn ab. Der Create-Handler muss
  dafür **status-bewusst** sein (draft ⇒ beide Calls, finalized ⇒ nur generate).
- **„Texte neu erzeugen" wird tertiär** — weniger auffindbar. Akzeptabel: der Hauptzyklus
  (Ändern → Booklet erstellen) deckt Regeneration mit ab.

**Darf nicht brechen (Checkliste für den Umbau):**

1. **Status-Maschine unverändert:** kein neuer Status, kein Sprung `draft → generated` ohne
   Finalize-Zwischenschritt; Reopen weiter nur aus `finalized|generated`; `sent+` nie zurückdrehbar.
2. **Generate-Semantik:** Re-Generate behält `access_token` + `short_code` (geteilte/gedruckte
   Links bleiben gültig — UI-Texte dürfen nicht suggerieren, es entstehe ein neuer Link).
3. **Deliver:** `count`-Guard gegen Doppelversand, Connector-Safe-Mode-Confirm, Reel-/E-Mail-
   Warnungen (Hinweis, kein Block), `picked_up_at=null`-Reset, nicht-blockierende E-Mail/Billing —
   alles unangetastet.
4. **Reel:** `RENDERABLE_STATUSES = generated|sent|viewed|shared` und „Render fasst den
   Order-Status NICHT an" (FIX 7.1) bleiben; der Nachträglich-Rendern-Pfad nach Versand muss in der
   neuen Zone erreichbar bleiben.
5. **Webhook-Verhalten:** unverändert (Auto-Versand nur bei `generated`, Pickup-Flag bei
   `draft|finalized`). Das Redesign **hilft** hier sogar: ein Ein-Tap-Erstellen senkt die
   Wahrscheinlichkeit, dass Aufträge bei Abholung noch un-generiert sind (weniger Warn-Badges).
6. **Listen-Logik:** Quick-Filter „Nicht generiert" (`draft+finalized`), Warn-Badge-Bedingung und
   `ReelStatePill` (nur bei `generated`) hängen an den Statuswerten — bleiben gültig, nicht anfassen.
7. **Guards doppelt lassen:** `need_media` client- und serverseitig; Client-Disable ist UX, der
   Server bleibt die Wahrheit.
8. **Marker:** Portal-eigene Booklet-Links immer `?c=1&p=1` (Kunden-Sicht + No-Track); Kunden-Links
   (E-Mail/QR) nur `c=1`.
9. **Konventionen:** kein `<form>`, `div/button + onClick`, i18n statt Inline-Strings, Mobile-first
   (Buttons ≥ 64px Tap-Target, `capture-btn`-Muster), Timeout/AbortController-Muster der bestehenden
   Handler übernehmen.
10. **Reel-Staleness** (Defekt 7): im Redesign-Scope nur als **statischer Hinweis** lösen („Nach
    Änderungen Reel neu erstellen, damit die Intro-Texte übereinstimmen") — ein echter
    Stale-Detektor bräuchte einen Generierungs-Zeitstempel (keine Spalte vorhanden ⇒ Migration),
    das ist bewusst NICHT Teil dieses Umbaus.

**Aufwands-Einordnung:** Reines Frontend (page.tsx + drei Control-Dateien + i18n + etwas CSS).
Keine Migration, keine Route-Änderung, kein Webhook-Risiko. Der riskanteste Teil ist der
status-bewusste Create-Handler (Chaining + Recovery) — er ersetzt aber nur zwei heute getrennte,
bereits existierende Fehlerpfade.
