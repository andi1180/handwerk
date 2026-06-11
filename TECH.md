# Valooro Handwerk — Technische Dokumentation

Eigenständiges Repo & **eigenes Supabase-Projekt** (keine geteilte Codebasis/DB mit dem Hotel-Projekt). Migrationen starten frisch ab `0001`. Migrationen werden **manuell** über das Supabase-Dashboard (SQL Editor) angewendet — nie lokal ausgeführt, nie `supabase db reset`.

---

## DB-Schema (Migration 0001)

Das DB-Fundament besteht aus 7 Tabellen (alle im Schema `public`). Datei: [supabase/migrations/0001_handwerk_foundation.sql](supabase/migrations/0001_handwerk_foundation.sql).

### Tabellen

| Tabelle | Zweck | Schlüsselfelder |
| --- | --- | --- |
| `businesses` | Betrieb/Mandant (Tenant-Wurzel). | `id`, `name`, `business_email` (unique), `slug` (unique), `status` (`active`/`suspended`), `default_language`, `branding`/`settings` (jsonb), `consent_text`, `retention_months` (1–120), `stripe_customer_id`, `webhook_secret` |
| `business_users` | Mitgliedschaft: verknüpft `auth.users` mit einem Betrieb (Basis aller RLS-Checks). | `business_id`, `user_id` (→ `auth.users`), `role` (`owner`/`staff`), unique(`business_id`,`user_id`) |
| `orders` | Auftrag/Job eines Betriebs (Kundendaten + Einwilligung). | `business_id`, `customer_name/_email/_phone`, `external_ref`, `item_description`, `language`, `status` (`draft`→`finalized`→`generated`→`sent`→`viewed`→`shared`), `consent_given`, `consent_at` |
| `order_media` | Foto-/Video-Assets zu einem Auftrag. | `order_id`, `business_id`, `media_type` (`photo`/`video`), `storage_path`, `keyword`, `tag` (`vorher`/`nachher`/`prozess`), `caption`, `sort_order`, `duration_seconds`, `width`/`height` |
| `booklets` | Generiertes, teilbares Ergebnis-Booklet (1:1 zu `orders`). | `order_id` (unique), `business_id`, `access_token` (unique, app-generiert, unerratbar ≥ 24 Byte base64url), `intro_title/_description`, `review_draft`, `ig_caption`, `web_story_ready`, `reel_url`, `image_urls` (jsonb), `language`, `sent_at`/`viewed_at`/`first_shared_at`/`expires_at` |
| `billing_events` | Abrechnungsrelevante Ereignisse (MVP: `booklet_sent`). | `business_id`, `booklet_id` (set null), `order_id` (set null), `event_type` (`booklet_sent`) |
| `booklet_events` | Engagement-/Analytics-Events zum Booklet. | `booklet_id`, `business_id`, `event_type` (`viewed`/`shared`/`qr_click`/`link_click`), `channel`, `ip_hash` |

`updated_at` wird per Trigger (`set_updated_at()`, SECURITY INVOKER) auf `businesses`, `orders`, `booklets` gepflegt.

### RLS- & GRANT-Ansatz

- **RLS ist auf allen 7 Tabellen aktiv.**
- **`authenticated` = Betriebs-Mitglieder:** Jede Policy prüft die Mitgliedschaft **inline** über `business_users` (`exists (select 1 from business_users bu where bu.business_id = <tbl>.business_id and bu.user_id = auth.uid())`). Bewusst **keine** SECURITY-DEFINER-Hilfsfunktion, um die Angriffsfläche klein zu halten.
  - `businesses`: select/update für Mitglieder.
  - `business_users`: select nur eigene Zeilen (`user_id = auth.uid()`).
  - `orders`, `order_media`: voller CRUD-Zugriff (`for all`, mit `using` + `with check`) für Mitglieder.
  - `booklets`: select/update für Mitglieder (Insert/Delete laufen serverseitig über `service_role`).
  - `billing_events`, `booklet_events`: nur select für Mitglieder (Schreiben serverseitig).
- **Explizite GRANTs, kein `anon`, kein `PUBLIC`:** Default-Privilegien für `anon`/`PUBLIC` werden defensiv per `revoke all` entfernt; danach werden nur die benötigten Rechte gezielt an `authenticated` vergeben. `service_role` erhält `grant all`.
- **`service_role` = voller Zugriff** (umgeht RLS) — für serverseitige API/Edge-Funktionen.
- **Öffentliche Booklet-Reads** (Endkunden ohne Login) laufen **ausschließlich** über die `service_role`-API mit **server-seitiger `access_token`-Validierung** — `anon` hat **keine** Tabellen-Grants und damit keinen Direktzugriff.

### Isolations-Regeln (Mandanten-Trennung)

1. **Eigenes Supabase-Projekt** — kein geteiltes Schema/keine geteilte DB mit dem Hotel-Projekt.
2. **Defensives `REVOKE FROM anon/PUBLIC`** in jeder Migration (Supabase grantet per Default an `anon`!), gefolgt von expliziten, minimalen GRANTs.
3. **REVOKE-EXECUTE-Pflicht:** Jede künftige `SECURITY DEFINER`-Funktion **muss** `revoke execute on function <fn> from public;` + einen gezielten Grant erhalten. (Aktuell existiert keine solche Funktion.)
4. **Verifikations-Gate als stehender Pre-Pilot-Check:** [supabase/verify/0001_isolation_checks.sql](supabase/verify/0001_isolation_checks.sql) vor **jedem** Pilot im SQL-Editor ausführen. Prüft: (1) RLS auf allen Tenant-Tabellen aktiv, (2) keine `anon`-Grants, (3) keine SECURITY-DEFINER-Funktion ohne REVOKE, (4) Laufzeit-Isolation (als Betrieb A keine Zeilen von Betrieb B — manuell mit zwei Test-Betrieben + zwei Auth-Usern).

### i18n-Datenfelder

- `businesses.default_language` — Standardsprache des Betriebs (Default `de`).
- `orders.language`, `booklets.language` — Sprache pro Auftrag/Booklet (Default `de`), erlaubt mehrsprachige Ausgabe je Vorgang.

---

## App-Scaffold (Schritt 2a)

Next.js 15 (App Router), React 19, TypeScript `strict` + `noUncheckedIndexedAccess`. Paketmanager: **pnpm**. Noch ohne Auth (Schritt 2b) und ohne Feature-/Portal-Seiten — eine baubare, lauffähige leere App.

### Struktur

```
app/
  layout.tsx     Root-Layout: lädt globals.css + Plus Jakarta Sans (next/font/google,
                 Gewichte 400/500/600/700 als --font-sans), html lang="de".
  page.tsx       Platzhalter-Startseite ("Valooro Handwerk", zentriert).
  globals.css    Token-System + Utility-Klassen (s. u.).
lib/
  supabase/      Drei Supabase-Clients (s. u.).
  i18n/          Typsicherer i18n-Layer (s. u.).
next.config.ts   reactStrictMode.
tsconfig.json    strict, noUncheckedIndexedAccess, Pfad-Alias @/* → ./*.
.env.example     Vorlage der drei benötigten Env-Variablen (ohne Werte).
```

### Supabase-Clients (`lib/supabase/`)

Wir nutzen **`@supabase/ssr`** (nicht das deprecated `auth-helpers`-Paket) für die RLS-gebundenen Clients und **`@supabase/supabase-js`** für den `service_role`-Client.

| Datei | Factory | Paket | Zweck |
| --- | --- | --- | --- |
| `client.ts` | `createClient()` | `@supabase/ssr` → `createBrowserClient` | Browser/Client Components. anon-Key, RLS. |
| `server.ts` | `async createClient()` | `@supabase/ssr` → `createServerClient` | Server Components / Route Handlers / Server Actions. Liest Session-Cookies über das Next.js-15-`await cookies()`-API. anon-Key, RLS, authentifizierter Kontext. |
| `service.ts` | `createServiceClient()` | `@supabase/supabase-js` → `createClient` | **Nur server-seitig.** `service_role`-Key, umgeht RLS. Für öffentliche Booklet-Reads (server-seitige `access_token`-Validierung) und serverseitige Inserts/Deletes. **Niemals in Client Components importieren, niemals mit `NEXT_PUBLIC_` prefixen.** |

Env-Variablen: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Browser + Server), `SUPABASE_SERVICE_ROLE_KEY` (nur `service.ts`). Die Clients werden erst zur Laufzeit instanziiert — die App baut auch ohne echte Env-Werte.

### i18n-Layer (`lib/i18n/`)

Minimal, aber vollständig typsicher. MVP: nur `de`.

- `types.ts` — `Locale` (`'de'`) sowie generische Pfad-Helfer `DictKey`/`DictValue` (punktseparierte, getypte Schlüsselpfade).
- `de.ts` — deutsches Dictionary (`as const`); seine Struktur ist die **kanonische Form** aller Sprachen.
- `index.ts` — `DEFAULT_LOCALE`, `Dictionary` (= `typeof de`), `getDictionary(locale)` und der typsichere Helfer `t(locale, key)` (z. B. `t("de", "app.name")` → autocompletet den Schlüssel, der Rückgabetyp folgt dem Pfad).

**Neue Sprache = neue Dict-Datei** (muss `Dictionary` erfüllen) + Eintrag in der `dictionaries`-Registry. Kein Refactor.

### CSS-Token-System (`app/globals.css`)

Design-Tokens als CSS-Custom-Properties unter `:root` (Farben, Gold-Akzente, `--radius: 8px`). Body nutzt `var(--font-sans)`, `--text-primary`, `--bg`. Utility-Klassen: `.btn-dark`, `.btn-gold`, `.btn-outline` (Gold-Hover), `.card`, `.divider-gold`, `.form-input` (Gold-Focus-Border).

### Routen-Konvention (noch nicht gebaut)

- **Portal** (eingeloggte Betriebe) später unter `/portal/*` — **desktop-first**.
- **Öffentliches Booklet** (Endkunden ohne Login) unter `/b/[token]` — **mobile-first**, Daten ausschließlich über die `service_role`-API mit server-seitiger `access_token`-Validierung.

---

## Auth (Schritt 2b)

Geteilter Betriebs-Login: ein Betrieb (Mandant) teilt sich Anmeldedaten; jede Anmeldung ist ein `auth.users`-Eintrag, der über `business_users` genau einem Betrieb zugeordnet ist. Noch **keine** Module/Features — nur Login, Session und eine geschützte Portal-Shell. `@supabase/ssr` ist auf `0.12.x` angehoben; die Cookie-Schnittstelle (`getAll`/`setAll`) ist unverändert, Browser- und Server-Client (Schritt 2a) bleiben gültig.

### Login-Flow

- [app/login/page.tsx](app/login/page.tsx) ist die **einzige** Client Component der Auth-Schicht. E-Mail-/Passwort-Felder als `div + onClick` (kein `<form>`), `.form-input`-Styling, zentriertes `.card`-Layout mit Valooro-Tokens.
- Anmeldung über den Browser-Client (`signInWithPassword`): Erfolg → `router.replace("/portal")` + `router.refresh()`; Fehler → i18n-Meldung (`login.error`). Bereits eingeloggte Nutzer werden beim Laden direkt nach `/portal` umgeleitet.

### Middleware-Schutz von `/portal/*`

- [middleware.ts](middleware.ts) implementiert den Standard-`@supabase/ssr`-Session-Refresh (updateSession-Pattern): liest/schreibt die Auth-Cookies bei jedem Request über `getAll`/`setAll` und ruft direkt danach `auth.getUser()` auf.
- Ohne gültige Session führt jeder Aufruf unter `/portal/*` zu einem Redirect auf `/login`. Der `matcher` schließt statische Assets aus (`_next/static`, `_next/image`, `favicon.ico`, gängige Bildformate).

### Betriebs-Auflösung (`getCurrentBusiness`)

- [lib/auth/current-business.ts](lib/auth/current-business.ts) löst serverseitig den Betrieb des eingeloggten Nutzers auf — **ausschließlich** über den AUTHENTICATED Server-Client (RLS-erzwungen, **kein** `service_role`).
- Ablauf: `auth.getUser()` → eigene Zeile in `business_users` (RLS: Nutzer sieht nur die eigene Mitgliedschaft) → zugehörige `businesses`-Row (RLS: member-Policy). Rückgabe `{ id, name, default_language, status } | null`.

### Portal-Shell

- [app/portal/layout.tsx](app/portal/layout.tsx) (Server Component, desktop-first): Auth-Check (kein User → `/login`), `getCurrentBusiness()` (kein Betrieb → freundlicher Hinweis), sonst Sidebar-Shell. Sidebar: 220px, weißer BG, rechte Border `1px solid var(--border)`; Nav-Item „Dashboard" aktiv (`border-left 2px var(--gold)` + `var(--gold-light)`); unten ein Logout-Button.
- [app/portal/page.tsx](app/portal/page.tsx): Platzhalter-Dashboard, „Willkommen, {name}" (`portal.welcome`).
- [app/portal/logout-button.tsx](app/portal/logout-button.tsx): kleine Client-Komponente, `signOut()` → Redirect `/login`.

### i18n & Seed

- Neue Dictionary-Schlüssel in [lib/i18n/de.ts](lib/i18n/de.ts): `login.*`, `portal.welcome`/`portal.noBusiness`, `nav.dashboard`/`nav.logout`. Keine Inline-Strings in der UI.
- [supabase/seed/0001_test_business.sql](supabase/seed/0001_test_business.sql) legt einen Test-Betrieb („Schneideratelier Demo") an und verknüpft einen vorhandenen Auth-User als `owner`. Wird **manuell** im SQL-Editor des Handwerk-Projekts ausgeführt (Auth-User vorher im Dashboard anlegen).

---

## Aufträge (Schritt 3)

Erstes echtes Feature: Aufträge anlegen und auflisten — der **manuelle Pfad** (kein Capture/Media, keine Generierung). **Mobile-first**: ein Mitarbeiter legt Aufträge am Tresen oder unterwegs am Handy an; einspaltiges Layout, große Tap-Targets, funktioniert aber auch am Desktop.

### Navigation

- [app/portal/portal-nav.tsx](app/portal/portal-nav.tsx) ist eine **Client Component** (Aktiv-Zustand hängt vom Pfad via `usePathname` ab). Items: „Dashboard" (aktiv bei `=== /portal`) und „Aufträge" (aktiv bei `startsWith(/portal/orders)`). Aktiv = `border-left 2px var(--gold)` + `var(--gold-light)` (Hotel-Muster). Die Portal-Shell ([app/portal/layout.tsx](app/portal/layout.tsx)) rendert nur noch `<PortalNav />`.

### Auftragsliste

- [app/portal/orders/page.tsx](app/portal/orders/page.tsx) (Server Component): lädt Aufträge über den **AUTHENTICATED Server-Client**. RLS skopiert automatisch auf den Betrieb des Nutzers; zusätzlich wird **defensiv** nach `business_id` aus `getCurrentBusiness` gefiltert. Sortierung `created_at DESC`.
- Pro Zeile: `customer_name`, `external_ref` (falls vorhanden), Status-Badge, Datum (`de-DE`, `dd.MM.yyyy`).
- Leerer Zustand: i18n-Hinweis (`orders.empty`) + „Neuer Auftrag"-Button. Oben rechts „Neuer Auftrag" (`.btn-dark`) → `/portal/orders/new`.

### Status-Badge

- [components/order-status-badge.tsx](components/order-status-badge.tsx): mappt alle Status (`draft`/`finalized`/`generated`/`sent`/`viewed`/`shared`) auf i18n-Label + dezenten Farbsatz (Pill, `border-radius: 999px`). `draft` = neutral (`--surface`/`--border`). Exportiert zugleich den `OrderStatus`-Typ (Spiegel der DB-Check-Constraint), den die Liste verwendet. Reine Präsentation — Server-Component-fähig.

### Anlage-Formular

- [app/portal/orders/new/page.tsx](app/portal/orders/new/page.tsx) (Server-Page) rendert die einzige Client Component der Route, [new-order-form.tsx](app/portal/orders/new/new-order-form.tsx).
- Felder (`div + onClick` / `.form-input`, **kein `<form>`-Tag**): `customer_name` (Pflicht), `customer_email`, `customer_phone`, `external_ref` (Hinweis „z. B. roapp-Nr."), `item_description` (Textarea, Hinweis „KI-Kontext"), `consent_given` (Checkbox, nicht-blockierend, klarer Hinweistext).
- Validierung: leerer `customer_name` → inline i18n-Fehler (`orders.nameRequired`), kein Request. Absenden → POST an `/api/portal/orders` **ohne `business_id`**; Erfolg → `router.push("/portal/orders")`, Fehler → `orders.createError`.

### Route Handler

- [app/api/portal/orders/route.ts](app/api/portal/orders/route.ts), `POST`: AUTHENTICATED Server-Client. `auth.getUser()` → kein User → **401**; `getCurrentBusiness()` → kein Betrieb → **403**.
- **Isolationsregel:** `business_id` stammt **ausschließlich** aus `getCurrentBusiness` (Session), **niemals** aus dem Body. Insert über RLS-Policy `orders_all` (kein `service_role`).
- Insert: `business_id`, `customer_name` (required, sonst **400**), `customer_email`/`customer_phone`/`external_ref`/`item_description` (getrimmt, leer → `null`), `language = business.default_language`, `status = 'draft'`, `consent_given` (bool aus Body), `consent_at = now()` falls `consent_given`, sonst `null`. Gibt die neue `order.id` zurück (**201**).

### i18n

- Neue Schlüssel in [lib/i18n/de.ts](lib/i18n/de.ts): `nav.orders`, `orders.*` (Titel, Felder, Hinweise, Aktionen, Fehlermeldungen) und `orderStatus.*` (Entwurf/Abgeschlossen/Generiert/Gesendet/Angesehen/Geteilt). Keine Inline-Strings in der UI.

---

## Storage + Auftrags-Detail (Schritt 4a)

Storage-Fundament (Migration 0002) plus Auftrags-Detailseite mit reiner **Medien-Anzeige**. **Noch ohne Capture/Upload** (folgt in 4b) und **ohne Generierung**. **Mobile-first**: ein Mitarbeiter öffnet einen Auftrag am Handy.

### Storage-Bucket & Policies (Migration 0002)

Datei: [supabase/migrations/0002_storage.sql](supabase/migrations/0002_storage.sql) — **manuell** im SQL-Editor anwenden.

- **Bucket `order-media`** (`public = false`): privater Bucket, `on conflict do nothing` (idempotent).
- **Pfad-Konvention:** `{business_id}/{order_id}/{media_id}` — das **erste Pfad-Segment ist die `business_id`** und damit die Mandanten-Grenze im Storage.
- **Tenant-skopierte Policies auf `storage.objects`** (nur `authenticated`): `order_media_select`/`_insert`/`_delete` erlauben Zugriff genau dann, wenn `bucket_id = 'order-media'` **und** der eingeloggte Nutzer Mitglied des Betriebs ist, dessen Id im ersten Pfad-Segment steht (`(storage.foldername(name))[1] = bu.business_id::text`).
- **`service_role`** umgeht RLS (für spätere server-seitige Generierung) — **keine** Policy nötig. **`anon`**: keine Policy = **kein** Zugriff.
- **Privater Bucket → Signed URLs:** Reads laufen nie direkt; die Detailseite erzeugt pro Medium **server-seitig** eine `createSignedUrl(path, 3600)` (Ablauf 3600 s).
- Verifikation: [supabase/verify/0002_storage_checks.sql](supabase/verify/0002_storage_checks.sql) prüft (1) Bucket existiert + privat, (2) genau 3 `order_media_*`-Policies, alle nur für `authenticated`.

### Query-Helper (`lib/orders/queries.ts`)

[lib/orders/queries.ts](lib/orders/queries.ts), beide über den **AUTHENTICATED Server-Client** (RLS), typsicher:

- `getOrderById(id)` → `OrderDetail | null`. RLS skopiert auf den Betrieb; fremde/fehlende id → `null` (Seite ruft `notFound()`).
- `getOrderMedia(orderId)` → `OrderMedia[]`, sortiert nach `sort_order` ASC. Exportiert zugleich `MediaTag` (`vorher`/`nachher`/`prozess`).

### Detailseite (`app/portal/orders/[id]/page.tsx`)

[app/portal/orders/[id]/page.tsx](app/portal/orders/[id]/page.tsx) (Server Component, mobile-first):

- **Dauerhaft sichtbarer Kopf** (sticky): `customer_name` + Status-Badge (Wiederverwendung von [components/order-status-badge.tsx](components/order-status-badge.tsx)) + „Zurück zur Liste"-Link (`orderDetail.back`).
- **Stammdaten** (nur falls vorhanden): `external_ref`, `customer_email`, `customer_phone`, `item_description`, sowie das Anlagedatum (`de-DE`).
- **Medien-Liste:** lädt `order_media` (RLS, `sort_order` ASC). Pro Item: Thumbnail (Foto → `<img>` mit Signed-URL; Video → Typ-Icon), Medientyp-Icon (Inline-SVG Foto/Video), `keyword` und `tag`-Pill. Leerer Zustand: `orderDetail.noMedia`.
- **Kein Capture-Button** in 4a (folgt in 4b).
- Die **Auftragsliste** ([app/portal/orders/page.tsx](app/portal/orders/page.tsx)) ist nun zeilenweise klickbar (`<Link>` auf `/portal/orders/[id]`, Hover-Stil `.card-link` → `--surface-2`).

### i18n

Neue Schlüssel in [lib/i18n/de.ts](lib/i18n/de.ts): `orderDetail.back`/`.media`/`.noMedia` und `mediaTag.vorher`/`.nachher`/`.prozess`. Keine Inline-Strings in der UI.

## Foto-Capture + Upload (Schritt 4b)

Aufnahme und Upload von **Fotos** auf der Detailseite. **Nur Foto** — Video folgt in 4c. **Mobile-first**: native Kamera, große Tap-Targets, Hände am Werkstück.

### Zweistufiger Upload (isolations-sicher)

Der Upload ist bewusst zweigeteilt, damit die große Binärdatei **nicht** durch einen Route Handler fließt, die Mandanten-Isolation aber dennoch erzwungen bleibt:

1. **Datei → Storage (direkt, BROWSER-Client).** Die komprimierte JPEG wird vom Client direkt in den privaten Bucket `order-media` geladen, unter dem Pfad `{business_id}/{order_id}/{uuid}.jpg`. Die Storage-RLS aus [0002](supabase/migrations/0002_storage.sql) bindet das **erste Pfad-Segment an die `business_id`** des Nutzers — ein fremder Pfad wird vom Storage abgelehnt.
2. **Metadaten → Route Handler.** Erst nach erfolgreichem Storage-Upload geht ein `POST` an [app/api/portal/orders/[id]/media/route.ts](app/api/portal/orders/[id]/media/route.ts) mit `{ storage_path, media_type, keyword, tag, width, height }` — **ohne `business_id`**.

**ISOLATION (mehrstufig) im Route Handler:** `getCurrentBusiness` (Session) → kein User/Betrieb ⇒ 401/403. Die Order wird über den **AUTHENTICATED Server-Client** (RLS) geladen; fremde/fehlende `order_id` ⇒ 404. Die `business_id` stammt **aus der geladenen Order** (= Session-Betrieb), nie aus dem Body. Validiert wird: `media_type ∈ {'photo'}`, `storage_path` beginnt mit `${business_id}/${order_id}/`, `tag ∈ {vorher,nachher,prozess}` (oder null). `sort_order = coalesce(max(sort_order),0)+1` je Order. Insert über den AUTHENTICATED Client (RLS-Policy `order_media_all`), kein `service_role`.

### Client-Kompression ([lib/media/](lib/media/))

- [constants.ts](lib/media/constants.ts): `MAX_IMAGE_DIM = 1500` (längste Kante), `JPEG_QUALITY = 0.8`. Video-Limit + Konfigurierbarkeit später.
- [compress.ts](lib/media/compress.ts): `compressImage(file)` dekodiert (EXIF-Orientierung via `createImageBitmap({ imageOrientation: "from-image" })`), skaliert seitenverhältnis-treu auf `MAX_IMAGE_DIM`, zeichnet auf ein Canvas und exportiert als JPEG → `{ blob, width, height }`. Spart Upload-Volumen.

### Capture-Komponente ([app/portal/orders/[id]/capture.tsx](app/portal/orders/[id]/capture.tsx), Client)

Props `businessId` + `orderId`. „Foto aufnehmen" löst ein verstecktes `<input type="file" accept="image/*" capture="environment">` (Ref). Danach: Vorschau (lokale `objectURL`), optionales **Stichwort** (`.form-input`), optionaler **Tag** (Vorher/Nachher/Prozess, Toggle), „Speichern"/„Verwerfen". Kein `<form>` — alles `div + onClick`.

- **Optimistische Liste + `router.refresh()`:** „Speichern" legt sofort ein optimistisches Item (lokales Thumbnail, Status „lädt…") an und gibt die UI frei (nächste Aufnahme sofort möglich). Im Hintergrund: komprimieren → Storage-Upload → Metadaten-POST. Bei 2xx wird das Item entfernt und `router.refresh()` überführt es in die server-gerenderte Liste (Signed-URLs wie 4a).
- **In-Memory-Retry-Queue:** mehrere Items parallel (kein IndexedDB). Der Storage-Upload macht bei Fehlern bis zu **2 Retries mit kurzem Backoff** (`upsert: true` überschreibt einen halb geladenen Pfad); danach Status „Fehler" + „Erneut"-Button, der denselben Pfad erneut versucht. `objectURL`s werden bei Erfolg/Verwerfen sowie beim Unmount freigegeben.

Die **Detailseite bleibt Server Component**; sie bindet `<Capture>` in der Medien-Sektion oberhalb der server-gerenderten Liste ein.

### i18n

Neuer Block `capture.*` in [lib/i18n/de.ts](lib/i18n/de.ts): `photo`, `keyword`, `keywordOptional`, `tag`, `tagOptional`, `save`, `discard`, `uploading`, `error`, `retry`.

---

## Video-Capture (Schritt 4c)

Aufbauend auf demselben Flow wie 4b — bestehende Capture-Komponente + Route Handler **erweitert, nicht dupliziert**. Keine neue Migration (`order_media.duration_seconds` existiert bereits aus 0001).

### Längen-Check (post-capture, kein Trim)

- [constants.ts](lib/media/constants.ts): `MAX_VIDEO_SECONDS = 30` (später via Settings konfigurierbar).
- [video.ts](lib/media/video.ts): `getVideoDuration(file)` liest die Dauer über ein verstecktes `<video preload="metadata">` (`loadedmetadata`); die Object-URL wird in jedem Fall freigegeben. Typsicher, kein `any`.
- Der Check läuft **nach** der Aufnahme: ist der Clip > `MAX_VIDEO_SECONDS`, wird er **abgelehnt** (i18n `capture.videoTooLong`, `{max}`-Platzhalter) — **kein Upload, kein clientseitiges Trimmen** (MVP).

### Keine Client-Kompression für Video

Anders als Fotos wird Video **nicht** clientseitig komprimiert (Canvas-Re-Encode wäre am Handy zu schwer) — die Datei geht **unverändert** in den Storage, unter `{business_id}/{order_id}/{uuid}.{ext}` (`ext` aus dem MIME-Subtyp, `quicktime → mov`, sonst Subtyp, Fallback `mp4`). Der `contentType` des Uploads ist der `file.type`. Hintergrund-Queue, 2 Retries und optimistische Liste werden **wiederverwendet** — `runUpload` verzweigt nur auf `media_type='video'`.

### Route-Handler-Erweiterung

[app/api/portal/orders/[id]/media/route.ts](app/api/portal/orders/[id]/media/route.ts): `media_type ∈ {'photo','video'}`. `duration_seconds` (numeric) wird akzeptiert — bei `'video'` **erforderlich** (> 0, sonst 400), bei `'photo'` ignoriert (`null`). Restliche Isolation/Validierung (Order gehört zum Betrieb, Pfad-Präfix `${business_id}/${order_id}/`, `sort_order = max+1`) unverändert; Insert um `duration_seconds` erweitert.

### Inline-Video in der Liste

Detailseite ([app/portal/orders/[id]/page.tsx](app/portal/orders/[id]/page.tsx)) rendert Video-Items als **inline abspielbares** `<video src={signedUrl} controls preload="metadata">` (server-seitige Signed-URL, 3600 s) — damit der Mitarbeiter den Clip direkt prüfen kann. Fotos unverändert (Thumbnail-Zeile).

### i18n

`capture.*` ergänzt um `video` und `videoTooLong` (mit `{max}`-Platzhalter, am Aufrufort interpoliert).

---

## Responsive Portal (Schritt 4d)

Das Portal wird **mobil-optimiert** — Mitarbeiter erfassen Medien am Handy. `/portal` bleibt **eine App** (kein eigener mobiler URL); das Chrome schaltet ausschließlich per **Media Query** um. **Breakpoint: `max-width: 768px` = Mobile.** Keine neuen Features, keine Migration. Tailwind wird weiterhin nicht verwendet — das Responsive-Verhalten lebt im CSS-Token-System ([app/globals.css](app/globals.css)).

### Shell-Umschaltung (Desktop ↔ Mobile)

[app/portal/layout.tsx](app/portal/layout.tsx) rendert **alle** Chrome-Varianten gleichzeitig ins DOM; CSS-Klassen blenden je Viewport das Passende ein/aus (kein User-Agent-Sniffing, eine einzige App):

- **Desktop (> 768px):** unverändert — 220px-Sidebar links (`.portal-sidebar` mit Betriebs-/App-Name, `<PortalNav />`, vollbreitem Logout), Content rechts (`.portal-main`, Padding 32). Top-Bar und Tab-Nav sind `display: none`.
- **Mobile (≤ 768px):** `.portal-shell` wird `display: block`, die Sidebar `display: none`. Stattdessen:
  - **Schlanke Top-Bar** (`.portal-topbar`, `position: sticky; top: 0`): links der **gekürzte Betriebsname** (Ellipsis), rechts der **kompakte Logout-Icon-Button** ([logout-button.tsx](app/portal/logout-button.tsx) mit `compact`-Prop). Feste Höhe über das Token `--portal-topbar-h`.
  - **Bottom-Tab-Nav** (`.portal-tabnav`, `position: fixed; bottom: 0`, app-artig, daumenreichbar): zwei Tabs „Dashboard" (`/portal`) und „Aufträge" (`/portal/orders`) mit Inline-SVG-Icon + Label. **Aktiver Tab = `--gold`** (Icon + Text via `data-active`), inaktiv `--text-secondary`. Aktiv-Erkennung über `usePathname` — dieselbe `ITEMS`-Definition wie die Sidebar ([portal-nav.tsx](app/portal/portal-nav.tsx) exportiert `PortalNav` für Desktop und `PortalTabNav` für Mobile).
  - **Content** (`.portal-main`) nimmt die volle Breite; `padding-bottom` (`--portal-tabnav-h` + Safe-Area) hält die Tab-Nav frei.

### Mobil-first Capture & Listen

- **Auftrags-Detail/Capture** ([app/portal/orders/[id]/page.tsx](app/portal/orders/[id]/page.tsx), [capture.tsx](app/portal/orders/[id]/capture.tsx)): Der sticky Kopf (Kundenname + Status) klinkt auf Mobile **unter** die Portal-Top-Bar ein (`.order-detail-head` mit `top: var(--portal-topbar-h)`). Die Aufnahme-Buttons „Foto"/„Video" sind die Kern-Aktion am Tresen — `.capture-btn` macht sie vollbreit und mobil besonders groß (`min-height: 64px`). Der Vorschau-/Stichwort-/Tag-Dialog ist auf Mobile **bildschirmfüllend**: `.capture-draft` schaltet von Inline-Card (Desktop) auf `position: fixed; inset: 0` (Vollbild-Sheet, scrollbar) um.
- **Auftragsliste** ([app/portal/orders/page.tsx](app/portal/orders/page.tsx)): Zeilen bleiben großflächige Tap-Targets (`.card`/`.card-link`); „Neuer Auftrag" wird auf Mobile prominent **über die volle Breite** (`.orders-new-btn`).
- **Anlage-Formular** ([new-order-form.tsx](app/portal/orders/new/new-order-form.tsx)) bleibt einspaltig; Eingaben werden mobil größer — `.form-input` bekommt unter dem Breakpoint `font-size: 16px` (verhindert iOS-Auto-Zoom) + mehr Padding.

### t()-Interpolation (i18n)

Der Übersetzungs-Helfer [lib/i18n/index.ts](lib/i18n/index.ts) hat jetzt echte, **typsichere Platzhalter-Interpolation**: `t(locale, key, params?)` ersetzt `{name}`, `{max}` etc. via `String.replace(/\{(\w+)\}/g, …)`; `params` ist `Record<string, string | number>` (kein `any`). Über **Funktions-Overloads** bleibt der Rückgabetyp ohne `params` das exakte Dictionary-Leaf-Literal (`DictValue`), mit `params` ein `string`. Die bisherigen `.replace()`-Aufrufstellen sind umgestellt: `portal.welcome` (`{name}`) in [app/portal/page.tsx](app/portal/page.tsx) und `capture.videoTooLong` (`{max}`) in [capture.tsx](app/portal/orders/[id]/capture.tsx).

### Video-Default

[lib/media/constants.ts](lib/media/constants.ts): `MAX_VIDEO_SECONDS` von 30 auf **20** gesenkt (Default 20s; später pro Betrieb konfigurierbar via Settings, Ceiling 30s).

## Basis-Settings (Schritt 5a)

Erste Slice des Settings-Moduls: pro Betrieb konfigurierbare Basis-Einstellungen (Branding-Farben/Font/Logo-Toggle, Video-Limit, Online-Links, Auslieferung, Aufbewahrung). **Keine neue Migration** — alles liegt in bestehenden Spalten. KEIN Logo-Upload (5b), KEIN Intro/Outro (5c), KEIN Slot-Editor (5d).

### Datenablage (bestehende Spalten aus 0001)

- `businesses.branding` (jsonb): `{ primary_color, secondary_color, font, logo_per_page }` — `logo_url` folgt in 5b.
- `businesses.settings` (jsonb): `{ video_max_seconds, ig_handle, google_review_url, website_url, delivery_mode }`.
- `businesses.retention_months` (Spalte, DB-Check 1…120), `businesses.name` (Spalte).

Die jsonb-Spalten werden beim Speichern **vollständig überschrieben** (in 5a gibt es keine weiteren Keys; 5b bezieht `logo_url` mit ein).

### Optionen & Grenzen ([lib/settings/options.ts](lib/settings/options.ts))

Eine geteilte Quelle für Auswahllisten, Grenzen, Defaults und Typ-Guards (`isHexColor`/`isFontOption`/`isDeliveryMode`) — genutzt von `getCurrentBusiness` (Defaults beim Lesen), Settings-Form (Auswahl + Client-Validierung) und Route Handler (Server-Validierung): `FONT_OPTIONS`, `DELIVERY_MODES` (`'manual' | 'auto'`), `VIDEO_SECONDS` (`{ min: 5, max: 30, default: 20 }`), `RETENTION_MONTHS` (`{ min: 1, max: 120, default: 12 }`), `DEFAULT_BRANDING`.

### `getCurrentBusiness`-Erweiterung ([lib/auth/current-business.ts](lib/auth/current-business.ts))

Rückgabe um `branding` (`BusinessBranding`), `settings` (`BusinessSettings`) und `retention_months` ergänzt — typsicher, **kein `any`**. Die jsonb-Felder kommen als `unknown` aus der Rohzeile und werden mit Defaults normalisiert/geclamped (z. B. `video_max_seconds ?? 20`, ungültige Hex/Font → Default).

### Seite & Form ([app/portal/settings/](app/portal/settings/))

- [page.tsx](app/portal/settings/page.tsx) (Server Component): lädt `getCurrentBusiness`, rendert die Client-Form mit den aktuellen Werten (defensiver `notFound()`-Guard — die Shell garantiert bereits einen Betrieb).
- [settings-form.tsx](app/portal/settings/settings-form.tsx) (Client, **kein `<form>`** — Speichern via `div + onClick`): Felder in `.card`-Gruppen (Betrieb / Branding / Aufnahme / Online-Präsenz / Auslieferung). Farb-Felder = Swatch (`<input type="color">`) + synchroner Hex-Text; Font/Delivery = `<select>`; `logo_per_page` = Toggle (`role="switch"`, div+onClick); Video/Retention = Range-Slider + gekoppeltes Zahlenfeld. Client-Validierung (nicht-leerer Name, Hex, Ranges) deckt sich mit dem Server; Erfolg/Fehler-Indikator über i18n. Desktop-first, dank `.form-input`/`.card` responsiv nutzbar.

### Route Handler ([app/api/portal/settings/route.ts](app/api/portal/settings/route.ts), `PATCH`)

AUTHENTICATED Client; `getCurrentBusiness` → sonst 401/403. **ISOLATION:** die `business_id` stammt aus der Session, NIE aus dem Body. Validierung (sonst 400): `name` nicht leer; `primary_color`/`secondary_color` gültiges Hex; `font ∈ FONT_OPTIONS`; `delivery_mode ∈ {manual,auto}`; `video_max_seconds ∈ [5,30]`; `retention_months ∈ [1,120]`. Update von `name`, `branding` (jsonb), `settings` (jsonb), `retention_months` für die Session-`business_id` über die RLS-Policy `businesses_update`; gibt die aktualisierten Werte zurück.

### Video-Limit-Verdrahtung

[app/portal/orders/[id]/page.tsx](app/portal/orders/[id]/page.tsx) lädt `business.settings.video_max_seconds` (`?? VIDEO_SECONDS.default`) und reicht es als Prop `maxVideoSeconds` an [capture.tsx](app/portal/orders/[id]/capture.tsx) durch. Der Capture nutzt das Prop für den Längen-Check; `MAX_VIDEO_SECONDS` bleibt nur noch Fallback-Default des Props.

### Navigation & i18n

Drittes Nav-Item „Einstellungen" → `/portal/settings` (Zahnrad-Icon) in der geteilten `ITEMS`-Definition ([portal-nav.tsx](app/portal/portal-nav.tsx)) — erscheint damit in Sidebar (Desktop) **und** Bottom-Tab-Nav (Mobile); Aktiv-Erkennung via `usePathname` (`startsWith("/portal/settings")`). Strings: `nav.settings` + `settings.*` ([lib/i18n/de.ts](lib/i18n/de.ts)), Hinweise/Fehler mit `t()`-Interpolation.

---

## Mobiler Booklet-Assembler 6a — Reorder + Löschen

Erste Slice des **mobilen Booklet-Assemblers** (ersetzt den ursprünglich geplanten Desktop-Sequenz-Builder): die Medien eines Auftrags werden **am Handy** sortierbar + löschbar, mit einheitlichen Vorschau-Größen und abspielbarem Video. **Keine** Captions (6b), **kein** Finalize (6c). **Keine neue Migration** (`order_media.sort_order` existiert aus 0001; Storage-Delete-Policy aus 0002).

### Architektur-Klärung: pro Auftrag (mobil) vs. pro Betrieb (Desktop)

Der frühere Plan eines Desktop-Sequenz-Builders **entfällt**. Stattdessen:

- **Pro Auftrag = mobil** (am Werkstück/Tresen): Capture (4b/4c) → **Reorder/Löschen (6a)** → Captions (6b) → Abschließen (6c). Alles auf der Detailseite, daumenbedienbar.
- **Pro Betrieb = Desktop** (einmalige Einrichtung): Settings (5a), Logo (5b), Intro/Outro, Hintergründe/Backgrounds.

### Abhängigkeit (dnd-kit)

`@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2 (pnpm). **Keine** React-19-Peer-Konflikte — dnd-kit wurde wie geplant verwendet (kein Long-Press-Eigenbau/Pfeil-Fallback nötig).

### Medien-Liste ([app/portal/orders/[id]/media-list.tsx](app/portal/orders/[id]/media-list.tsx), Client)

Die Server-Page lädt `order_media` (RLS, `sort_order` ASC) inkl. server-seitiger Signed-URLs (3600 s) und übergibt sie als Props `{ orderId, items }` an `<MediaList>` (ersetzt die bisher server-gerenderte Liste; `<Capture>` + `router.refresh()` bleiben unverändert darüber). Der Typ `MediaWithUrl` (= `OrderMedia & { signedUrl }`) wird hier exportiert und von der Page importiert.

- **Lokaler State aus Props:** `items` startet aus den Props; ein `useEffect([initialItems])` setzt den State neu, wenn der Server neu rendert (Capture-Refresh, Navigation). Eigene `setState`-Aufrufe ändern die Prop-Referenz nicht — der optimistische State wird also nicht überschrieben.
- **Einheitliches Raster:** `.media-grid` (3 Spalten mobil, ab Desktop `auto-fill minmax(140px)`) aus quadratischen `.media-tile`-Kacheln (`aspect-ratio: 1 / 1`, `object-fit: cover`). **Fotos und Videos gleich groß.** Video-Kachel: erstes Frame via `<video preload="metadata" src="…#t=0.1">` als Poster (das `#t`-Fragment geht **nicht** an den Server, die Signatur bleibt gültig) + dekoratives Play-Overlay. Inneres `img`/`video` hat `pointer-events: none`, damit Taps/Drag an die Kachel gehen.
- **Reorder (dnd-kit Sortable):** `DndContext` + `SortableContext` (rect-Strategie). **Sensoren:** `TouchSensor` mit `activationConstraint.delay ≈ 220ms` (Long-Press zum Greifen → Tippen/Scrollen bleibt frei; **kein** `touch-action: none`) und `MouseSensor` mit `distance: 8` (ein Klick öffnet die Vorschau, erst ein Zug reordert). Beim Drop: **optimistisches** `arrayMove` + `PATCH` (s. u.); bei Fehler Rollback auf den vorigen Stand + i18n-Hinweis (`assembler.reorderError`).
- **Tap = ansehen/abspielen (nicht reorder):** ein Tap auf die Kachel öffnet einen Vollbild-`MediaViewer` (Overlay; Foto groß bzw. `<video controls autoPlay>`; Schließen per X, Backdrop-Klick oder Escape → zurück zur gleich großen Kachel). Ein `draggedRef`-Flag (in `onDragStart` gesetzt, ~50 ms nach Drop zurückgesetzt) unterdrückt den unmittelbar nach einem echten Drag folgenden Klick.
- **Löschen:** kleiner Lösch-Button pro Kachel (`.media-tile-delete`, obere Ecke; `stopPropagation` auf Pointer/Click, damit weder Drag noch Vorschau auslösen) → Bestätigung (`window.confirm`, `assembler.deleteConfirm`) → **optimistische** Entfernung + `DELETE` → bei Erfolg `router.refresh()`; bei Fehler Rollback + i18n-Hinweis (`assembler.deleteError`).

### Route Handler — Reorder ([…/media/reorder/route.ts](app/api/portal/orders/[id]/media/reorder/route.ts), `PATCH`)

AUTHENTICATED Server-Client (kein `service_role`). `getCurrentBusiness` → 401/403; Order über RLS (fremde/fehlende id ⇒ 404). Body `{ ids: string[] }`: validiert als nicht-leeres String-Array **ohne Duplikate**, das **exakt** der Medien-Menge dieser Order entspricht (alle vorhandenen Ids, keine fremden, keine fehlenden) — sonst 400. Setzt `sort_order = Position+1` (1..n) via mehrerer `update`-Aufrufe, jeweils zusätzlich defensiv auf `order_id` gefiltert; `order_media`-RLS greift ohnehin.

### Route Handler — Löschen ([…/media/[mediaId]/route.ts](app/api/portal/orders/[id]/media/[mediaId]/route.ts), `DELETE`)

AUTHENTICATED Server-Client. `getCurrentBusiness` → 401/403. Die Medien-Zeile wird über RLS geladen **und** gegen `order_id` (Pfad) geprüft (fremde/fehlende Kombination ⇒ 404). Reihenfolge: erst `storage.from('order-media').remove([storage_path])` (Delete-Policy bindet das erste Pfad-Segment an die `business_id`), dann die `order_media`-Zeile (RLS-Policy `order_media_all`, defensiv auf `order_id`). `sort_order`-Lücken bleiben unkritisch (Sortierung ist ASC). Die statische Route `media/reorder` und die dynamische `media/[mediaId]` liegen konfliktfrei nebeneinander (Next.js bevorzugt das statische Segment).

### i18n

Neuer Block `assembler.*` in [lib/i18n/de.ts](lib/i18n/de.ts): `reorderHint` („Halten zum Verschieben"), `delete`, `deleteConfirm`, `play`, `close`, `reorderError`, `deleteError`.

---

## KI-Captions 6b — Batch, Regenerate, Edit (Haiku 4.5)

Zweite Slice des mobilen Assemblers: kurze, deutsche Bildunterschriften (memorybook-Stil) für die Medien eines Auftrags. **Erste Anthropic-Integration.** **Keine neue Migration** (`order_media.caption` existiert aus 0001). **Kein** Finalize (6c).

### Anthropic-Integration (server-only)

- **SDK:** `@anthropic-ai/sdk` (pnpm). Client in [lib/ai/anthropic.ts](lib/ai/anthropic.ts): lazily instanziiert, prozessweit gecacht. Key **ausschließlich** aus `ANTHROPIC_API_KEY` (server-only — **nie** `NEXT_PUBLIC`, nie im Client). `getAnthropic()` wirft, wenn der Key fehlt; `isAiConfigured()` ist der Route-Guard (⇒ 500 `ai_not_configured`, statt stillem Leerlauf).
- **Modell:** Haiku 4.5, ID `claude-haiku-4-5-20251001` (Konstante `HAIKU_MODEL`). Haiku 4.5 unterstützt **kein** `effort`/adaptives Thinking → schlichter `messages.create`-Request, `max_tokens: 64`.
- **`.env.example`** um `ANTHROPIC_API_KEY=` ergänzt.

### Caption-Generator ([lib/ai/captions.ts](lib/ai/captions.ts))

`generateCaption({ mediaType, keyword, imageBase64?, imageMediaType? })` → kurzer Caption-String.

- **FOTO:** Bild (base64) **+** Stichwort gehen als Vision-Input (`{ type: "image", source: { type: "base64", … } }` + Text) an Haiku.
- **VIDEO:** **nur** das Stichwort — die Frame-Extraktion folgt später mit dem Reel (Kommentar im Code). Ein Video **ohne** Stichwort liefert einen **leeren** String zurück (manuell nachzutragen), ohne die API zu bemühen.
- **System-Prompt:** „sehr kurze Bildunterschriften … max ~8 Wörter, ein knappes Fragment … Deutsch, kein Marketing-Sprech, keine Anführungszeichen, keine Emojis, kein abschließender Punkt". Output = nur der Caption-Text; `cleanCaption()` entfernt defensiv umschließende Anführungszeichen + einen abschließenden Punkt und kürzt auf `CAPTION_MAX_LENGTH` (120).
- **Client-sicheres Limit:** `CAPTION_MAX_LENGTH` liegt in [lib/ai/caption-limits.ts](lib/ai/caption-limits.ts) (kein SDK-Import) und wird von `captions.ts` re-exportiert — so kann der Client das Limit importieren, **ohne** den Anthropic-SDK ins Client-Bundle zu ziehen.
- **Storage-Helfer** [lib/ai/media-caption.ts](lib/ai/media-caption.ts): lädt das Bild server-seitig über den **AUTHENTICATED** Client (RLS) aus dem privaten Bucket (`storage.download` → `Buffer` → base64), leitet den Bild-Medientyp aus der Endung ab und ruft `generateCaption`.

### Route Handler

Alle AUTHENTICATED (kein `service_role`), `getCurrentBusiness` → 401/403, Order/Media gegen Session+`order_id` validiert (⇒ 404).

- **Batch** ([…/captions/route.ts](app/api/portal/orders/[id]/captions/route.ts), `POST`): lädt alle `order_media` **mit `caption IS NULL`** (manuelle Edits werden so nie überschrieben), generiert mit begrenzter Nebenläufigkeit (`mapWithConcurrency`, max. 3 parallel), speichert pro Treffer `caption` (Update defensiv auf `order_id`). Leere Captions (Video ohne Stichwort) werden **nicht** gespeichert → bleiben offen. Gibt `{ updated: { id, caption }[] }` zurück. Guard `isAiConfigured()` ⇒ 500.
- **Regenerate** ([…/media/[mediaId]/caption/regenerate/route.ts](app/api/portal/orders/[id]/media/[mediaId]/caption/regenerate/route.ts), `POST`): generiert ein **einzelnes** Item neu und **überschreibt** dessen Caption (leer ⇒ `null`). Generierungsfehler ⇒ 502. Gibt `{ id, caption }` zurück.
- **Manuelles Edit** ([…/media/[mediaId]/caption/route.ts](app/api/portal/orders/[id]/media/[mediaId]/caption/route.ts), `PATCH`): speichert editierten Text (Body `{ caption }`); Länge serverseitig auf `CAPTION_MAX_LENGTH` begrenzt (sonst 400), leer ⇒ `null`. **Keine KI** (reines Update, kein `isAiConfigured`-Guard). Gibt `{ id, caption }` zurück.

### UI ([app/portal/orders/[id]/media-list.tsx](app/portal/orders/[id]/media-list.tsx), Client)

- **Query/Type:** `OrderMedia` + `getOrderMedia` um `caption` erweitert; fließt über `MediaWithUrl` an die Liste.
- **Batch-Button** „Captions generieren" (`.btn-dark`, oben neben dem Reorder-Hinweis): Ladezustand `captions.generating`, deaktiviert wenn nichts fehlt (`missingCount === 0`). POST → optimistisches Anwenden der `updated`-Captions + `router.refresh()`.
- **Caption-Bearbeitung im Vollbild-Viewer** (nicht in den engen Kacheln): Der Viewer ist eine Flex-Spalte (Medium oben, Panel unten). `CaptionEditor` (key = `media.id`) zeigt `media.keyword` als Kontext, ein `textarea.form-input` (`maxLength`), einen **Neu-generieren**-Icon-Button (dreht sich während der Generierung, `@keyframes spin`) und **Speichern** (`.btn-gold`). Manuelles Edit → PATCH; Regenerate → POST; beide aktualisieren `text` lokal **und** den Parent-State (`onCaptionChange`), sodass der Kachel-Indikator sofort umspringt. Feedback `captions.saved`/`captions.error` inline. Der `viewing`-Eintrag wird aus `items` **abgeleitet** (State `viewingId`), damit Caption-Updates ohne Refresh sichtbar sind.
- **Kachel-Indikator** (`.media-tile-caption`, obere linke Ecke, `pointer-events: none`): Untertitel-Icon, gefüllt (`--gold`) = hat Caption, schwach = fehlt.

### i18n

Neuer Block `captions.*` in [lib/i18n/de.ts](lib/i18n/de.ts): `generate`, `generating`, `regenerate`, `edit`, `save`, `saved`, `empty`, `error`.

---

## Caption-Länge + Datei-Upload (Schritt 6b.1)

Zwei kleine Anpassungen an 6b/Capture — **keine neuen Konzepte, keine Migration**.

### Caption-Länge 180 / ~12–15 Wörter

- `CAPTION_MAX_LENGTH` in [lib/ai/caption-limits.ts](lib/ai/caption-limits.ts) von **120 → 180**. Das Limit ist die **einzige Quelle**: der PATCH-Server-Check (manuelles Edit) und das Client-`maxLength` der Caption-`textarea` referenzieren die Konstante — nichts ist hartkodiert, alles läuft konsistent auf 180.
- System-Prompt in [lib/ai/captions.ts](lib/ai/captions.ts) von „max ~8 Wörter" auf **„~12–15 Wörter, ein knappes, ansprechendes Fragment"** umgestellt (Stilregeln unverändert: kein Marketing-Sprech, keine Anführungszeichen/Emojis/Punkt). `max_tokens` 64 → **128**, damit längere Captions nicht mittendrin abgeschnitten werden; `cleanCaption()` kürzt weiterhin defensiv auf `CAPTION_MAX_LENGTH`.

### Datei-Upload zusätzlich zur Live-Aufnahme ([capture.tsx](app/portal/orders/[id]/capture.tsx))

Neben „Foto/Video **aufnehmen**" (native Kamera, `<input … capture="environment">`) gibt es jetzt „Foto/Video **hochladen**" über `<input type="file" accept="image/*|video/*">` **ohne** `capture` — das öffnet Galerie/Dateiauswahl statt der Kamera.

- **Nur die Quelle unterscheidet sich.** Die Upload-Inputs hängen an **denselben** Handlern (`handlePhotoFile`/`handleVideoFile`); die komplette nachgelagerte Pipeline ist wiederverwendet, **nichts dupliziert**: Foto → `compressImage`; Video → `getVideoDuration` + Längen-Check (`maxVideoSeconds`, Ablehnung wie 4c); danach Hintergrund-Upload + In-Memory-Queue/Retry + Metadaten-POST (`business_id` aus Session, Isolation unverändert).
- **Layout:** Die Buttons sind in zwei Zeilen gruppiert (`.capture-row`: Zeile „Aufnehmen" = Foto/Video, Zeile „Hochladen" = Foto/Video), je zwei gleich breite, große Tap-Targets (`.capture-btn`, mobil `min-height: 64px`).
- **i18n:** `capture.uploadPhoto`/`capture.uploadVideo` ergänzt.

---

## Finalize + Lifecycle (Schritt 6c)

Schließt den **mobilen Assembler** ab: aus dem Editier-Modus wird per Knopfdruck ein abgeschlossenes Booklet — und zurück. **Keine neue Migration** (Status-Spalte + Check-Constraint aus 0001), **keine Generierung** (das ist Schritt 8; der Generierungs-Hook hängt sich später an den Finalize-Übergang).

### Status-Übergänge (draft ↔ finalized)

- **Finalize** `draft → finalized` ([…/finalize/route.ts](app/api/portal/orders/[id]/finalize/route.ts), `POST`): schließt das Booklet ab.
- **Reopen** `finalized → draft` ([…/reopen/route.ts](app/api/portal/orders/[id]/reopen/route.ts), `POST`): öffnet es wieder zur Bearbeitung.
- Beide ohne Body — Betrieb/Order werden im Handler gegen die Session geprüft (AUTHENTICATED Client, kein `service_role`): kein User ⇒ 401, kein Betrieb ⇒ 403, fremde/fehlende Order (RLS) ⇒ 404. Spätere Stufen (`generated`/`sent`/…) lassen sich **nicht** zurückdrehen (Reopen verlangt exakt `finalized`).

### Finalize-Guards

- Aktueller Status muss **`draft`** sein (Reopen: **`finalized`**) — sonst **409**. Das `UPDATE` ist zusätzlich defensiv auf den Ausgangsstatus gefiltert (`.eq("status", …)`), kein Doppel-Übergang bei Races.
- **Mindestens ein `order_media`** (`count`, head) — sonst **400 `need_media`**. Ohne Medium gibt es kein Booklet abzuschließen.

### Editier- vs. Abgeschlossen-Modus ([page.tsx](app/portal/orders/[id]/page.tsx))

Die Detailseite (Server Component) leitet aus dem Status zwei Flags ab (`isDraft`, `isFinalized`) und schaltet das UI:

- **`draft` (Editier-Modus):** Capture sichtbar, [media-list.tsx](app/portal/orders/[id]/media-list.tsx) voll aktiv (Reorder/Löschen/Captions), plus ein prominenter **„Booklet abschließen"** am Seitenende (`<FinalizeButton>`, `btn-gold capture-btn`, mobil groß). Klick → Bestätigungsdialog (`finalize.confirm` + `finalize.confirmText`) → `POST finalize` → `router.refresh()`. Ohne Medium gar kein Request, sondern direkt `finalize.needMedia` (Server prüft zusätzlich).
- **`finalized` (Abgeschlossen-Modus):** Capture **ausgeblendet**; `<MediaList readOnly>` unterdrückt alle Mutations-Controls — keine Drag-Listener (`useSortable({ disabled })`), keine Lösch-Buttons, kein Batch-Captions-Kopf, Caption im Viewer **read-only** (`<CaptionReadOnly>` statt Editor). Ansehen/Abspielen bleibt. Am Seitenkopf ein Banner **„Booklet abgeschlossen"** (`<FinalizeBanner>`, gold) mit **„Wieder bearbeiten"** → `POST reopen` → `router.refresh()`.
- `<FinalizeButton>`/`<FinalizeBanner>` ([finalize-controls.tsx](app/portal/orders/[id]/finalize-controls.tsx), Client) teilen sich ein `postAction(orderId, "finalize"|"reopen")` — keine Logik dupliziert.

### Lifecycle-Badges nach Stufe ([order-status-badge.tsx](components/order-status-badge.tsx))

Farben gruppieren jetzt nach **Stufe** statt pro Status, damit die Auftragsliste auf einen Blick „in Arbeit / fertig / gesendet" zeigt:

- **neutral** (surface/border) = `draft` (in Arbeit)
- **Gold** (`--gold-light`/`--gold-border`) = `finalized` + `generated` (fertig)
- **grünlich** (neue Tokens `--green-light`/`--green-border`/`--green-text`) = `sent` + `viewed` + `shared` (gesendet)

Labels unverändert (Entwurf/Abgeschlossen/Generiert/Gesendet/Angesehen/Geteilt).

### i18n

`finalize.button` / `confirm` / `confirmText` / `needMedia` / `done` (Banner) / `reopen` (+ `error` für fehlgeschlagene Aktion).

## Kachel entschlackt + Caption-Auswahl (Schritt 6b.2)

Zwei UI-Anpassungen am mobilen Assembler — **keine neuen Konzepte, keine Migration**.

### Tags raus (nur UI)

Die Tag-Auswahl (Vorher/Nachher/Prozess) ist aus dem Aufnahme-/Upload-Dialog ([capture.tsx](app/portal/orders/[id]/capture.tsx)) und aus der Kachel/dem Viewer ([media-list.tsx](app/portal/orders/[id]/media-list.tsx)) entfernt; das **Stichwort** bleibt. Der Metadaten-`POST` schickt kein `tag` mehr, und der Insert in [media/route.ts](app/api/portal/orders/[id]/media/route.ts) setzt `order_media.tag` **nicht mehr** (bleibt `null`).

> **`order_media.tag`-Spalte bleibt erhalten** (keine Migration; auch der `MediaTag`-Typ und das `getOrderMedia`-Select bleiben). Das Feld ist seit 6b.2 **vorhanden, aber ungenutzt** — eine spätere Reaktivierung für ein Vorher/Nachher-Format ist damit ohne DB-Änderung möglich. Die `mediaTag.*`- sowie `capture.tag`/`capture.tagOptional`-i18n-Keys sind entfernt.

### Caption-Auswahl: ein zusammengelegter Indikator

Jede Kachel trägt oben links **genau einen** Indikator (`.media-tile-indicator`) mit drei Zuständen; der Lösch-Button sitzt zur klaren Trennung in der **gegenüberliegenden** Ecke (oben rechts):

- **ohne Caption + nicht ausgewählt** → leerer Kreis (Outline, `--select`).
- **ohne Caption + ausgewählt** → gefüllter Gold-Kreis mit Häkchen (`--select.is-selected`).
- **mit Caption** → Caption-Icon (Status, `--caption`, `pointer-events: none` — kein Auswahl-Verhalten).

Tap auf den Indikator (nur bei Kacheln **ohne** Caption) toggelt die Auswahl (`onPointerDown`/`onClick` `stopPropagation` → kein Drag, kein Öffnen des Viewers). Tap auf den Kachel-Body bleibt Ansehen/Abspielen, Long-Press bleibt Drag. Die Auswahl (`selectedIds: Set<string>`) wird bei jedem Prop-Refresh auf weiterhin vorhandene, unbeschriftete Medien gestutzt.

**Smarter „Captions generieren"-Button:** sind Kacheln ausgewählt, generiert er **nur** diese (uncaptioned), sonst **alle** ohne Caption (bisheriges Verhalten); das Label wird zu `captions.generateSelected` ({count}). Nach Erfolg wird die Auswahl zurückgesetzt; die betroffenen Kacheln zeigen via `router.refresh()`/Live-Update das Caption-Icon. Im **readOnly**-Modus (finalized) gibt es keine Auswahl und keinen Trash; Kacheln mit Caption zeigen das Caption-Icon als Status.

### Batch-Endpoint ([captions/route.ts](app/api/portal/orders/[id]/captions/route.ts))

Optionales Body-Feld `{ ids?: string[] }`: ist eine nicht-leere Auswahl gesetzt, wird die Query zusätzlich `.in("id", ids)` gefiltert (nur diese, und weiterhin nur `caption IS NULL`); fehlt/leer/ungültig ⇒ alle ohne Caption. Die `ids` werden durch `.eq("order_id", …)` (RLS-skopiert auf den Session-Betrieb) validiert — fremde ids matchen schlicht nicht.

### i18n

Neu: `captions.select` (Auswahl-Aria-Label), `captions.selected` ({count}), `captions.generateSelected` ({count}). Entfernt: `mediaTag.*`, `capture.tag`, `capture.tagOptional`.

---

## Caption-Auswahl explizit + Upload-Härtung (Schritt 6b.3)

Zwei kleine Robustheits-/UX-Fixes — **keine neuen Konzepte, keine Migration**.

### Caption-Auswahl jetzt explizit ([media-list.tsx](app/portal/orders/[id]/media-list.tsx))

Das in 6b.2 noch enthaltene „leer ⇒ alle"-Verhalten **entfällt im UI**: „Captions generieren" ist **deaktiviert (grau, nicht klickbar)**, solange keine Kachel ausgewählt ist (`disableGenerate = generating || selectedCount === 0`), und `handleGenerate` sendet **immer** konkrete `ids` (bei leerer Auswahl gar kein Request).

- Neuer **„Alle auswählen"**-Toggle neben dem Generieren-Button: ohne Auswahl markiert er alle Medien **ohne** Caption (`selectAll`), mit Auswahl heißt er **„Auswahl aufheben"** (`clearSelection`). So bleibt „alle captionen" = **zwei Taps** (Alle auswählen → generieren). Der Toggle ist versteckt, wenn nichts zu beschriften ist (`missingCount === 0`).
- Der **Batch-Endpoint** ([captions/route.ts](app/api/portal/orders/[id]/captions/route.ts)) bleibt **unverändert**; sein „leer/fehlend ⇒ alle"-Fallback wird vom UI nicht mehr getriggert (harmlos, als Sicherheitsnetz belassen).

### Upload-Härtung ([capture.tsx](app/portal/orders/[id]/capture.tsx))

`runUpload` ist in **drei klar getrennte Schritte** zerlegt — Aufbereitung (Foto komprimieren), **Storage-Upload**, **Metadaten-POST** —, jeder mit eigenem `try/catch` und präzisem `console.error` (welcher Schritt + echte Fehlermeldung + `order_id`/`storage_path`). Der Fehlerhinweis im Listen-Item ist konkreter (`capture.uploadError` „Upload fehlgeschlagen. Bitte erneut.").

- **Retry auf beiden Wegen:** Nicht nur der Storage-Upload (`uploadWithRetry`), auch der Metadaten-POST hat jetzt eigenes Retry (`postMetadataWithRetry`) — bis zu **2 Retries mit Backoff** (`UPLOAD_MAX_ATTEMPTS`/`UPLOAD_BACKOFF_MS`, geteilt). Transient sind Netzwerk-Ausfälle und **HTTP 5xx**; **HTTP 4xx** (ungültiger Body/Pfad) werfen sofort `PermanentError` (Retry zwecklos).
- **Orphan-Cleanup:** War der Storage-Upload erfolgreich, der Metadaten-POST aber **endgültig** fehlgeschlagen, wird die hochgeladene Datei per `storage.remove([path])` wieder entfernt — kein verwaistes File, ein erneuter Versuch (`Erneut`) startet sauber (zudem `upsert: true` auf dem Upload).

### Server-Logging ([media/route.ts](app/api/portal/orders/[id]/media/route.ts))

`console.error` mit Kontext (`order_id`, Schritt, bei `invalid_path` zusätzlich erwarteter/erhaltener Pfad, bei `insert_failed` das Supabase-`error`) an allen Fehler-Ausgängen → erscheint in den Vercel-Logs und macht den vorher stillen `metadata_failed`-Pfad diagnostizierbar.

### i18n

Neu: `captions.selectAll`, `captions.deselectAll`, `capture.uploadError`.

---

## Logo-Upload (Schritt 7a)

Erste Slice der **Desktop-Business-Config** (Schritt 7): ein Betrieb lädt sein Logo hoch, sieht eine Vorschau und kann es entfernen. **Desktop-first** (Settings = einmalige Einrichtung pro Betrieb). **Erste neue Migration seit 0002** (`0003`). KEIN Intro/Outro (7b), KEINE Backgrounds (7c).

### Storage-Bucket & Policies (Migration 0003)

Datei: [supabase/migrations/0003_branding.sql](supabase/migrations/0003_branding.sql) — **manuell** im SQL-Editor anwenden.

- **Bucket `branding`** (`public = false`): privat, `on conflict do nothing` (idempotent).
- **Warum privat + Signed-URL statt public-read** (als Kommentar in der Migration): Architektur-Konsistenz mit `order-media` — **ein** Zugriffsmodell, **eine** Isolations-Grenze (erstes Pfad-Segment = `business_id`). Das öffentliche Booklet `/b/[token]` rendert server-seitig über `service_role` und signiert das Logo bei **jedem** Request frisch, der Ablauf ist also irrelevant. Public-read würde einen zweiten Bucket-Typ einführen, den man bei jeder Isolations-Frage mitdenken müsste; der Logo-Wert rechtfertigt das nicht.
- **Tenant-skopierte Policies auf `storage.objects`** (nur `authenticated`, Muster exakt wie 0002): `branding_select`/`_insert`/`_update`/`_delete`, erlaubt wenn `bucket_id = 'branding'` **und** der Nutzer Mitglied des Betriebs im ersten Pfad-Segment ist (`(storage.foldername(name))[1] = bu.business_id::text`). Die **`_update`-Policy ist nötig**, weil der Upload mit `upsert = true` ein vorhandenes Objekt überschreibt. **Kein `anon`, kein PUBLIC**; `service_role` umgeht RLS (für das spätere Booklet-Rendering) → keine Policy nötig.
- **Keine Schema-Änderung:** `logo_url` lebt im bestehenden `businesses.branding`-jsonb (keine neue Spalte).
- Verifikation: [supabase/verify/0003_branding_checks.sql](supabase/verify/0003_branding_checks.sql) — (1) Bucket existiert + privat, (2) genau 4 `branding_*`-Policies, alle nur `authenticated`, (3) keine `anon`-Policy auf dem Bucket (0 Zeilen).

### Client-Aufbereitung ([lib/media/logo.ts](lib/media/logo.ts), NEU)

`compressImage` wird **nicht** wiederverwendet (JPEG-Export verlöre den Alpha-Kanal). `prepareLogo(file)`: akzeptiert nur `image/png|jpeg|webp` (sonst `LogoPrepareError("type")`), lehnt > 5 MB am Input ab (`"tooLarge"`), skaliert seitenverhältnis-treu auf max. **512 px** (längste Kante) via Canvas und exportiert als **PNG** (Alpha bleibt) → `{ blob }`. Der typisierte `LogoPrepareError` (`type`/`tooLarge`/`decode`) wird in der Form auf i18n gemappt; `LOGO_ACCEPT_ATTR` (aus `ACCEPTED_LOGO_TYPES`) speist das `accept`-Attribut, damit es nicht driftet.

### Zweistufiger Upload (isolations-sicher wie 4b)

1. **Datei → Storage (direkt, BROWSER-Client):** die aufbereitete PNG geht direkt in den Bucket `branding` unter dem **fixen** Pfad `${business_id}/logo.png` mit `upsert = true` (überschreibt das vorige Logo). Die Storage-RLS aus 0003 bindet das erste Segment an die `business_id`.
2. **Metadaten → Route Handler:** `POST /api/portal/settings/logo` mit `{ storage_path }` — **ohne `business_id`**.

### Route Handler ([app/api/portal/settings/logo/route.ts](app/api/portal/settings/logo/route.ts))

AUTHENTICATED Client, `getCurrentBusiness` → 401/403. `business_id` **aus der Session**.

- **`POST`:** validiert `storage_path === ${business_id}/logo.png` (sonst **400 `invalid_path`**). **READ-MERGE-WRITE:** lädt das aktuelle `branding`-jsonb, setzt **nur** `logo_url = storage_path`, schreibt es über `businesses_update` (RLS) zurück; gibt das neue `branding`.
- **`DELETE`:** `storage.remove(['${business_id}/logo.png'])` (Remove-Fehler werden geloggt, brechen aber nicht hart ab — die `branding`-Referenz ist die UI-Quelle der Wahrheit), danach `branding.logo_url` per READ-MERGE-WRITE auf `null`.

### KRITISCH: Settings-PATCH logo-sicher ([app/api/portal/settings/route.ts](app/api/portal/settings/route.ts))

Der 5a-`PATCH` überschrieb `branding` vollständig und hätte `logo_url` damit **weggeschrieben**. Jetzt **READ-MERGE-WRITE**: aktuelles `branding` laden, die vier 5a-Form-Felder (`primary_color`/`secondary_color`/`font`/`logo_per_page`) mergen, `logo_url` (und evtl. weitere Keys) **beibehalten**. **Symmetrisch:** die Logo-Endpoints fassen **nur** `logo_url` an, der Settings-`PATCH` **nur** seine Felder. Der jsonb-Guard `asRecord` liegt jetzt geteilt in [lib/settings/options.ts](lib/settings/options.ts) (genutzt von `getCurrentBusiness` + beiden Route-Handlern, keine Duplikate).

### Typen & Seite

- [lib/auth/current-business.ts](lib/auth/current-business.ts): `BusinessBranding` um `logo_url: string | null` (Default `null` via `asTrimmedOrNull`), `DEFAULT_BRANDING` ergänzt — typsicher, kein `any`.
- [app/portal/settings/page.tsx](app/portal/settings/page.tsx) (Server Component): erzeugt bei gesetztem `logo_url` eine `createSignedUrl(path, 3600)` und reicht sie als Prop `logoPreviewUrl` an die Form.
- [app/portal/settings/settings-form.tsx](app/portal/settings/settings-form.tsx): neue `.card`-Gruppe „Logo" mit `<LogoField>` (eigene Mutations-Logik, **getrennt** vom „Speichern" der Form). Vorschau (signierte URL bzw. optimistische `objectURL` bis zum Refresh) + „Entfernen", sonst Upload-Control (verstecktes `<input type="file">`, `div + onClick`, **kein `<form>`**). Upload → `prepareLogo` → Storage-Upload → `POST` → `router.refresh()`. Der `logo_per_page`-Toggle (5a) bleibt unverändert in der Branding-Gruppe.

### i18n

Neuer Block `settings.logo.*` in [lib/i18n/de.ts](lib/i18n/de.ts): `title`, `upload`, `uploading`, `remove`, `removing`, `preview`, `error`, `typeError`, `tooLarge`.

---

## Intro/Outro-Text (Schritt 7b)

Bewusst schmale Slice der Desktop-Business-Config: nur die Text-/Kontaktfelder, die der Renderer in Step 8 sicher braucht. **Keine** Migration (Keys im bestehenden `businesses.settings`-jsonb, wie 5a), **kein** neuer Bucket, **kein** neuer Endpoint — der bestehende Settings-`PATCH` (read-merge-write aus 7a) wird nur um die neuen Keys erweitert. **Keine** Layout-/Template-/Hintergrund-Konfiguration (das ist 7c bzw. Step 8).

### Datenmodell (`businesses.settings`, neue Keys)

Alle vier `string | null`, Default `null`, leer ⇒ `null` (getrimmt):

- `intro_tagline` — optionaler **fester Claim UNTER dem KI-Titel** auf der Intro-Seite (≤ 80). Leer ⇒ Intro zeigt nur KI-Titel/Beschreibung aus Step 8. **Kein** fester Intro-Titel — der ist KI.
- `outro_message` — optionale Dankes-/Abschiedszeile auf der Outro-Seite (≤ 300).
- `contact_email` — **ÖFFENTLICHE** Kontakt-Mail fürs Outro (E-Mail-Format wenn gesetzt). **Nicht** `business_email`/Login.
- `contact_phone` — öffentliche Telefonnummer fürs Outro (Freitext ≤ 40).

`website_url`, `ig_handle`, `google_review_url` existieren bereits aus 5a und werden im Outro/Buttons wiederverwendet — hier **nicht** neu angelegt.

### Optionen & Guards ([lib/settings/options.ts](lib/settings/options.ts))

Geteilt Client + Server (wie 5a): `CONTENT_LIMITS` (`introTagline: 80`, `outroMessage: 300`, `contactPhone: 40`), `EMAIL_REGEX` + Typ-Guard `isEmailFormat`. [lib/auth/current-business.ts](lib/auth/current-business.ts): `BusinessSettings` um die 4 Keys ergänzt, `normalizeSettings` liest sie via `asTrimmedOrNull` (jsonb `unknown` → Default `null`), typsicher, **kein `any`**.

### Route Handler ([app/api/portal/settings/route.ts](app/api/portal/settings/route.ts), `PATCH` — erweitert)

`business_id` weiterhin **ausschließlich** aus der Session. Die 4 neuen Keys werden validiert (Längen → `content_too_long`, E-Mail-Format → `invalid_email`, sonst 400) und in den `settings`-jsonb gemergt. **READ-MERGE-WRITE auch auf `settings`** (vorher wurde es voll überschrieben): bestehende/künftige Keys bleiben erhalten, nur die von der Form geführten Felder werden gesetzt — symmetrisch zum `branding`-Merge, der `logo_url`-Schutz aus 7a bleibt unangetastet.

### UI ([app/portal/settings/settings-form.tsx](app/portal/settings/settings-form.tsx))

Neue `.card`-Gruppe „Booklet-Inhalt": `intro_tagline` (`TextField` mit Hinweis), `outro_message` (neues `TextAreaField`), `contact_email` (`type="email"`), `contact_phone` — `div + onClick`, **kein `<form>`**, gespeichert über den **bestehenden** Settings-`PATCH` (ein Save für die ganze Seite, kein separater Button). Client-Validierung = Server-Validierung (`CONTENT_LIMITS`/`isEmailFormat`); `maxLength` an den Feldern referenziert dieselben Limits.

### i18n

Neuer Block `settings.content.*` in [lib/i18n/de.ts](lib/i18n/de.ts): `sectionTitle`, `introTagline`, `introTaglineHint`, `outroMessage`, `contactEmail`, `contactPhone`, `emailInvalid`, `tooLong`.

---

## Intro/Outro-Hintergründe (Schritt 7c)

Dritte Slice der Desktop-Business-Config: je **ein** Hintergrundbild für die
Intro- und die Outro-Seite des Booklets. **Keine** Migration, **kein** neuer
Bucket — der bestehende private `branding`-Bucket (0003) wird wiederverwendet.
Dessen Policies binden `bucket_id = 'branding'` **+ das erste Pfad-Segment** an
die `business_id` (Dateiname egal) — `intro-bg.jpg`/`outro-bg.jpg` sind damit
ohne Policy-Änderung abgedeckt.

**Bewusst schmal:** genau ein Bild pro Seite. **Kein** Per-Item-/Slot-Editor
(renderer-gekoppelt) und **keine** Aspect-/Crop-Logik hier — der Renderer
(Step 8) covert/croppt das Bild später auf 9:16 bzw. Portrait. Der **Slot-Editor
ist bis nach Step 8 deferred**.

### Client-Aufbereitung ([lib/media/background.ts](lib/media/background.ts), NEU)

`prepareLogo` wird **nicht** wiederverwendet (anderes Ziel: PNG/512 fürs Logo
vs. JPEG/1920 für den opaken full-bleed-Hintergrund). `prepareBackground(file)`:
akzeptiert nur `image/png|jpeg|webp` (sonst `BackgroundPrepareError("type")`),
lehnt > **10 MB** am Input ab (`"tooLarge"`), skaliert seitenverhältnis-treu auf
max. **1920 px** (längste Kante) via Canvas und exportiert als **JPEG q0.85**
(kleiner als PNG, Alpha hier irrelevant) → `{ blob }`. Der typisierte
`BackgroundPrepareError` (`type`/`tooLarge`/`decode`) wird in der Form auf i18n
gemappt; `BACKGROUND_ACCEPT_ATTR` speist das `accept`-Attribut.

### Datenmodell (`businesses.branding`, neue Keys)

Zwei neue Keys im bestehenden branding-jsonb, beide `string | null`, Default
`null`: `intro_bg_url`, `outro_bg_url`. Sie speichern — wie `logo_url` — den
**Storage-Pfad** (nicht die URL); die Signed-URL entsteht erst beim Rendern bzw.
für die Settings-Vorschau. [lib/auth/current-business.ts](lib/auth/current-business.ts):
`BusinessBranding` um beide Keys ergänzt, `normalizeBranding` liest sie via
`asTrimmedOrNull` (jsonb `unknown` → Default `null`), typsicher, **kein `any`**;
`DEFAULT_BRANDING` ([lib/settings/options.ts](lib/settings/options.ts)) ergänzt.

### Zweistufiger Upload (isolations-sicher wie 7a)

1. **Datei → Storage (direkt, BROWSER-Client):** die aufbereitete JPEG geht in
   den Bucket `branding` unter dem **fixen** Pfad `${business_id}/${slot}-bg.jpg`
   mit `upsert = true`. Die Storage-RLS aus 0003 bindet das erste Segment an die
   `business_id`. Der Pfad kommt aus dem geteilten `backgroundStoragePath(businessId, slot)`
   (options.ts) — eine Quelle für Client-Upload **und** Server-Validierung, kein Drift.
2. **Metadaten → Route Handler:** `POST /api/portal/settings/background` mit
   `{ storage_path, slot }` — **ohne `business_id`**.

### Route Handler ([app/api/portal/settings/background/route.ts](app/api/portal/settings/background/route.ts), NEU)

AUTHENTICATED Client, `getCurrentBusiness` → 401/403. `business_id` **aus der
Session**, `slot ∈ {'intro','outro'}` (geteilter Guard `isBackgroundSlot`, sonst
**400 `invalid_slot`**).

- **`POST`:** validiert `storage_path === ${business_id}/${slot}-bg.jpg` (sonst
  **400 `invalid_path`**). **READ-MERGE-WRITE:** setzt **nur** `intro_bg_url`
  **oder** `outro_bg_url` (je Slot); `logo_url`, Farben, font, logo_per_page und
  der andere Slot bleiben unangetastet. Gibt das neue `branding`.
- **`DELETE`:** `slot` aus dem JSON-Body; `storage.remove([…])` (Remove-Fehler
  werden geloggt, brechen nicht hart ab), danach den Slot-Key per
  READ-MERGE-WRITE auf `null`.

### DRY: geteilter branding-Merge ([lib/settings/branding-store.ts](lib/settings/branding-store.ts), NEU)

Der READ-MERGE-WRITE des branding-jsonb lag bisher inline im Logo-Handler
(`writeLogoUrl`). Mit 7c wäre er ein zweites Mal nötig → extrahiert nach
`mergeBranding(supabase, businessId, patch)` (server-only, `import type` auf den
Server-Client → keine Bundle-Leakage). Genutzt von **beiden** Branding-Endpoints
(Logo 7a + Hintergründe 7c); der Logo-Handler delegiert jetzt an `mergeBranding`,
sein Verhalten ist unverändert. Jeder Endpoint fasst weiterhin **nur** seine
eigenen Keys an (symmetrische Trennung, kein Wegschreiben fremder Werte).

### Seite & UI

- [app/portal/settings/page.tsx](app/portal/settings/page.tsx) (Server
  Component): signiert Logo, Intro- und Outro-Pfad über einen gemeinsamen
  `sign(path)`-Helfer (`createSignedUrl(path, 3600)`, `Promise.all`) und reicht
  `introBgPreviewUrl`/`outroBgPreviewUrl` als Props an die Form.
- [app/portal/settings/settings-form.tsx](app/portal/settings/settings-form.tsx):
  neue `.card`-Gruppe „Hintergründe" mit **zwei** `<ImageUploadField>` (Intro/
  Outro). Die Komponente ist aus dem 7a-`LogoField` **generalisiert**, aber
  **einmal** definiert und für beide Slots verwendet (keine Intro/Outro-
  Duplikation); das **7a-Logo-Feld bleibt unverändert**. Eigene Mutations-Logik
  (getrennt vom „Speichern" der Form): `prepareBackground` → Direktupload →
  `POST` → `router.refresh()`; Vorschau (signierte URL bzw. optimistische
  `objectURL`) + „Entfernen" → `DELETE`. `div + onClick`, **kein `<form>`**.
  Die Vorschau **spiegelt den realen Render-Ausschnitt**: zwei optionale Props
  `previewAspect` (Default Querformat) / `previewFit` (Default unverändert) steuern
  `aspect-ratio`/`object-fit` der Vorschau-Box; die Background-Felder setzen
  `previewAspect = 9/16` + `previewFit = "cover"` (Portrait, ~160px breit, mit
  Hinweis „so wird zugeschnitten") — wie der Renderer in Step 8 auf 9:16 covert.

### i18n

Neuer Block `settings.background.*` in [lib/i18n/de.ts](lib/i18n/de.ts):
`sectionTitle`, `intro`, `outro`, `upload`, `uploading`, `remove`, `preview`,
`typeError`, `tooLarge`, `error`.

---

## Booklet-Generierung 8a-1 (Web-Story-Daten)

Erste Slice von Schritt 8: aus einem abgeschlossenen Auftrag werden die
Booklet-Daten erzeugt — **KI-Intro (Sonnet 4.6)**, ein unerratbarer
`access_token`, Status `generated`. **OHNE Render** (`/b/[token]` folgt in 8a-2),
**ohne Reel** (8b), **ohne Share-/Review-/Delivery-UI** (Step 9). **Keine neue
Migration** (`booklets` existiert aus 0001).

### Sonnet-Integration (server-only, reuse 6b)

- [lib/ai/anthropic.ts](lib/ai/anthropic.ts): Konstante `SONNET_MODEL =
  "claude-sonnet-4-6"` neben `HAIKU_MODEL`. `getAnthropic()`/`isAiConfigured()`
  werden **wiederverwendet** (gleicher gecachter Client, Key nur aus
  `ANTHROPIC_API_KEY`, server-only).
- [lib/ai/intro.ts](lib/ai/intro.ts) (NEU): `generateIntro({ itemDescription,
  captions, businessName, language })` → `{ title, description }`. System-Prompt DE,
  **aus der Ich-Perspektive des teilenden Kunden** (FIX 8b-1c, s. u.): kurzer,
  persönlicher Titel (≤ ~6 Wörter) + 1–2 Sätze Ich-Story zur Transformation des
  Stücks, aus `item_description` + den vorhandenen Captions, der Betrieb beim Namen
  (`businessName`) als Erlebnis; kein Marketing-Sprech, keine Emojis. Sonnet liefert **nur JSON** `{"title":
  …,"description": …}` (kein Markdown/Backticks); **defensives Parsen**
  (Fence-Strip + Eingrenzung auf das erste `{…}` + `try/catch`) → bei
  Parse-Fehler `IntroParseError` (Route ⇒ **502**). `max_tokens: 300`.
  **Sprach-parametrisiert** über `language` (§15): `LANGUAGE_NAMES`-Map
  (`de → Deutsch`, Default = Code) — neue Sprache = Config, kein Refactor.

### Token ([lib/booklet/token.ts](lib/booklet/token.ts), NEU)

`generateAccessToken()` = `randomBytes(24).toString("base64url")` (24 Byte =
192 bit, URL-sicher, erfüllt die 0001-Vorgabe „≥ 24 Byte base64url"). Server-only
(`node:crypto`). Der Token ist die **einzige vertrauenswürdige Quelle** für den
späteren öffentlichen Read `/b/[token]` (§14.2): Token → Booklet → `business_id`.

### Route Handler ([…/generate/route.ts](app/api/portal/orders/[id]/generate/route.ts), `POST`)

AUTHENTICATED Server-Client zuerst (kein User ⇒ 401, kein Betrieb ⇒ 403). Order
über RLS geladen (fremde/fehlende id ⇒ 404). **Guards:** Status muss `finalized`
**oder** `generated` sein (Re-Generate erlaubt, solange NICHT versendet) ⇒ sonst
**409**; defensiv ≥ 1 `order_media` (`count`, head) ⇒ sonst **400 `need_media`**;
`isAiConfigured()` ⇒ sonst **500 `ai_not_configured`**. Captions der Order werden
über den AUTHENTICATED Client als Intro-Kontext geladen (`caption IS NOT NULL`,
`sort_order` ASC), dann `generateIntro(...)` (Fehler ⇒ **502 `intro_failed`**).

- **ISOLATION (§14.2):** Der booklets-Insert/Update läuft über **`service_role`**
  (0001-RLS lässt nur serverseitiges Insert/Delete zu). Die `business_id` stammt
  **aus der geladenen Order** (über RLS gegen die Session validiert), **nie aus
  dem Body**; jeder `service_role`-Zugriff ist strikt auf diese `business_id`
  gescoped (Select/Update zusätzlich `.eq("business_id", …)`).
- **UPSERT by `order_id` (unique):** zuerst bestehendes Booklet laden
  (order_id + business_id). Vorhanden ⇒ `update` (`intro_title`,
  `intro_description`, `language = order.language`, `web_story_ready = false`),
  **Token unverändert** (geteilte Links dürfen nicht brechen). Nicht vorhanden ⇒
  `insert` mit **neuem** `access_token`. `reel_url`/`review_draft`/`ig_caption`/
  `image_urls`/`expires_at` bleiben `null` (8b/9); `web_story_ready` setzt 8a-2
  nach Render-Fähigkeit.
- **Order-Status → `generated`** über den AUTHENTICATED Client (RLS), defensiv
  `.eq("status", order.status)` (kein Doppelübergang; bei Re-Generate No-op-Treffer).
- **Response** `{ ok: true, token }` (200). Fehlerpfade loggen `console.error`
  mit `order_id` + Schritt (wie 6b.3).

### Reopen erweitert ([…/reopen/route.ts](app/api/portal/orders/[id]/reopen/route.ts))

Der 6c-Reopen (`finalized → draft`) akzeptiert jetzt **auch `generated → draft`**
(Guard: Status ∈ {`finalized`,`generated`}, sonst 409; Update defensiv auf den
Ausgangsstatus gefiltert). Die Versand-Stufen (`sent`/`viewed`/`shared`) lassen
sich weiterhin **nicht** zurückdrehen. Das bereits erzeugte Booklet (inkl. Token)
bleibt bestehen — ein erneutes Generieren behält den Token.

### Portal-UI ([page.tsx](app/portal/orders/[id]/page.tsx) + [generate-controls.tsx](app/portal/orders/[id]/generate-controls.tsx), NEU)

Die Detailseite leitet `isGenerated` aus dem Status ab (neben `isDraft`/`isFinalized`):

- **`finalized`:** zusätzlich zum bestehenden „Wieder bearbeiten"-Banner ein
  prominenter **„Vorschau erzeugen"** (`<GenerateButton>`, `btn-gold capture-btn`)
  am Seitenende → `POST generate` → `router.refresh()`. Ohne Medium kein Request
  (Server prüft zusätzlich); Server-Fehlercode → i18n (`need_media`/
  `ai_not_configured`/sonst).
- **`generated`:** Banner **„Booklet generiert"** (`<GeneratedBanner>`, gold) mit
  Hinweis **„Vorschau-Seite folgt"** (der `/b/[token]`-Link kommt erst in 8a-2 —
  hier **nicht** verlinkt), **„Neu generieren"** (erneutes `POST generate`,
  überschreibt das Intro, behält den Token) und **„Wieder bearbeiten"** (Reopen,
  geteilt über das aus [finalize-controls.tsx](app/portal/orders/[id]/finalize-controls.tsx)
  exportierte `postAction`). Capture ausgeblendet, `<MediaList readOnly>`.

Beide Komponenten: `div + onClick`, **kein `<form>`**, Loading-/Fehler-State; der
Anthropic-SDK bleibt server-only (kein Import im Client-Bundle).

### i18n

Neuer Block `generate.*` in [lib/i18n/de.ts](lib/i18n/de.ts): `generate`,
`generating`, `regenerate`, `done`, `needMedia`, `error`, `aiNotConfigured`,
`previewSoon`.

---

## Betriebs-KI-Kontext (Schritt 8a-1b)

Der Betrieb hinterlegt einen **Fach-/Stilkontext** (Behavioral Prompt), der die
KI-Textgenerierung erdet — Fachsprache, Fokus und Ton. **Aktuell nur fürs Intro
(Sonnet)** verdrahtet; **nicht** in die Captions (Haiku ist auf Kürze getrimmt).
In **Schritt 9** wird derselbe Kontext für den Review-Entwurf wiederverwendet.
Eingebettet als **Kontext, nicht als Anweisung**. **Keine Migration** — der Key
lebt im bestehenden `businesses.settings`-jsonb (wie 7b).

### Datenmodell (`businesses.settings`, neuer Key)

- `ai_context` (`string | null`, Default `null`, getrimmt; leer ⇒ `null`).
  Längen-Cap **500** über `CONTENT_LIMITS.aiContext`
  ([lib/settings/options.ts](lib/settings/options.ts)) — geteilt von Client-`maxLength`
  und Server-Validierung.
- [lib/auth/current-business.ts](lib/auth/current-business.ts): `BusinessSettings`
  um `ai_context` erweitert, `normalizeSettings` liest ihn via `asTrimmedOrNull`
  (typsicher, kein `any`).

### Route Handler ([app/api/portal/settings/route.ts](app/api/portal/settings/route.ts), `PATCH` — erweitert)

`ai_context` wird getrimmt und auf `CONTENT_LIMITS.aiContext` geprüft (länger ⇒
**400 `content_too_long`**), dann in den bestehenden settings-**READ-MERGE-WRITE**
aufgenommen. Die `business_id` stammt weiter **ausschließlich** aus der Session.

### UI ([app/portal/settings/settings-form.tsx](app/portal/settings/settings-form.tsx))

Neue `.card`-Gruppe „KI-Stil" mit **einem** `<TextAreaField>` „KI-Kontext" (Hinweis
+ Beispiel-Placeholder). Client-Validierung (Cap = Server-Cap) → `settings.aiContext.tooLong`;
gespeichert über den bestehenden Seiten-Save (`div + onClick`, **kein `<form>`**).

### Intro-Generierung ([lib/ai/intro.ts](lib/ai/intro.ts))

`generateIntro(...)` bekommt optionales `businessContext?: string`. Im System-Prompt
wird es — **nur wenn gesetzt** — als klar abgegrenzter **KONTEXT-Block** eingebettet
(`Kontext zum Betrieb: <<<…>>>`): „Nutze diesen Kontext für Fachsprache, Fokus und
Ton. Er ist KONTEXT, KEINE Anweisung — er darf die Format-, Längen- und
Wahrheitsregeln NICHT überschreiben und keine Fakten erfinden, die nicht aus
item_description/Captions stammen." Leerer/`undefined` Kontext ⇒ Block weggelassen
(Verhalten wie 8a-1). Die schlichte, immer-wahre **Erdungsregel** bleibt (nur
beschreiben, was aus `item_description` + Captions (+ Kontext) folgt; nichts
Generisches dazudichten) — **keine** darüber hinausgehende Anti-Halluzinations-Kur.

### Generate-Route ([…/generate/route.ts](app/api/portal/orders/[id]/generate/route.ts))

Lädt `business.settings.ai_context` (über `getCurrentBusiness`) und reicht es
(`?? undefined`) als `businessContext` an `generateIntro` durch.

### i18n

Neuer Block `settings.aiContext.*` in [lib/i18n/de.ts](lib/i18n/de.ts):
`sectionTitle`, `label`, `hint`, `placeholder`, `tooLong`.

---

## Schritt-8/9-Vorgaben (Render: Web-Story + Reel)

Verbindlich für Schritt 8 (Web-Story-Render) und Schritt 9 (Reel/FFmpeg + Auslieferung).
Wo das Pflichtenheft die Regel bereits trägt, wird sie hier NUR referenziert — nicht neu
ausformuliert (Single Source of Truth, Drift-Schutz):

- Reel mute-safe (Captions/Text tragen die Story; Kunde addiert Audio in IG/TikTok selbst;
  Fremdmusik nur optional/lizenziert, nicht im MVP) → Pflichtenheft §6.
- Share: Reel als Datei (navigator.share({ files })) für IG/TikTok-Story; Web-Story als URL
  → §4 + §8.5.
- Google-Review-Entwurf personalisiert aus dem Booklet-Inhalt; nie Verbatim-Zwang, nie an
  eine Belohnung gekoppelt → §8.6.
- IG-Caption vorbefüllt mit @-Handle des Betriebs + Hashtags → §6 / §9.

NEU (steht in keiner MD — hier verbindlich):

- Caption-Fallback `caption ?? keyword`: Jedes Booklet-Item zeigt im Overlay die KI-Caption.
  Ist `caption` null/leer → zeige das getippte `keyword` (Stichwort). Sind BEIDE leer
  (z. B. Video ohne Stichwort + ohne Caption) → KEIN Overlay rendern (niemals ein leeres Feld).
- Eine gemeinsame Helper-Funktion, genutzt von Web-Story (Schritt 8) UND Reel-Overlay
  (Schritt 9) — nicht zweimal inline, sonst driften Story und Reel auseinander.
  Zielort: lib/booklet/caption.ts
  Signatur: displayCaption(media: { caption: string | null; keyword: string | null }): string | null
  (Rückgabe null = Overlay weglassen.)
  Die Funktion wird mit ihrem ersten Konsumenten in Schritt 8 angelegt; Schritt 9 importiert
  dieselbe Funktion. JETZT keine Orphan-Funktion anlegen (kein Konsument).

---

## Web-Story-Render 8a-2 (/b/[token])

Zweite Slice von Schritt 8: die **öffentliche, sichtbare Web-Story** zu einem
generierten Booklet — Vollbild-Scroll, Medien full-bleed, Caption unten in der
Safe-Zone, Intro/Outro. **Keine** Migration. **KEIN** Reel (8b), **KEINE**
Share-/Review-Buttons (Step 9), **KEIN** View-/Analytics-Tracking (Step 9/10).

### Token als Trust-Quelle (§14.2)

Der `access_token` aus der URL ist die **einzige** vertrauenswürdige Eingabe:
`token → booklets-Row → business_id`. Der Lookup und **alle** weiteren Reads
laufen ausschließlich über den **`service_role`**-Client
([lib/supabase/service.ts](lib/supabase/service.ts)) — **kein** anon-SELECT
(`anon` hat ohnehin keine Tabellen-Grants, 0001). Business (Branding/Settings)
und `order_media` werden **strikt** auf die `business_id`/`order_id` **aus der
Booklet-Row** gescoped, nie aus der URL/dem Client abgeleitet (außer dem Token).
Die Route liegt **nicht** unter `/portal` → der Middleware-Guard
([middleware.ts](middleware.ts), `pathname.startsWith("/portal")`) greift nicht,
die Seite ist öffentlich erreichbar (kein Matcher-Eingriff nötig).

### Lader ([lib/booklet/load.ts](lib/booklet/load.ts), NEU, server-only)

`loadPublicBooklet(token)` → diskriminiertes `PublicBookletResult`:
`not_found` (Seite ruft `notFound()` → 404), `expired` (einfache „nicht mehr
verfügbar"-Seite — `expires_at` gesetzt **und** vergangen; in 8a immer `null`,
forward-compat) oder `ok` mit `PublicBookletData`. Lädt Booklet (per unique
`access_token`), Business und Medien (`sort_order` ASC) und **signiert pro
Request frisch**: Medien aus Bucket `order-media`, `logo_url`/`intro_bg_url`/
`outro_bg_url` aus Bucket `branding`, je `createSignedUrl(path, 3600)` (Batch
`createSignedUrls` pro Bucket). Branding/Settings werden über die aus
[lib/auth/current-business.ts](lib/auth/current-business.ts) **exportierten**
`normalizeBranding`/`normalizeSettings` normalisiert (eine Quelle, kein Drift).

### Caption-Helper ([lib/booklet/caption.ts](lib/booklet/caption.ts), NEU)

Erster Konsument der Schritt-8/9-Vorgabe (oben): `displayCaption({ caption,
keyword })` = `caption ?? keyword`; beide leer (getrimmt) ⇒ `null` = **kein**
Overlay (niemals ein leeres Feld). Server-only, wird in Schritt 9 vom
Reel-Overlay **wiederverwendet** (nicht zweimal inline).

### Seite ([app/b/[token]/page.tsx](app/b/[token]/page.tsx), Server Component, mobile-first)

`export const dynamic = "force-dynamic"` (frische Signed-URLs, nichts cachen).
Vollbild-Scroll-Story: Container `scroll-snap-type: y mandatory`, jede Sektion
`100dvh` (**nicht** `100vh` — mobile Browser-Chrome), `scroll-snap-align: start`
+ `scroll-snap-stop: always`. Branding angewandt: die gewählte `branding.font`
über [lib/booklet/fonts.ts](lib/booklet/fonts.ts) (`next/font`, alle vier
FONT_OPTIONS selbst-gehostet, `preload: false` → nur die gesetzte Schrift wird
geladen); `primary_color`/`secondary_color` als CSS-Variablen
(`--bk-primary`/`--bk-secondary`) für Akzente/Links/Tagline/Fallback-Verläufe.
Styles in [app/b/[token]/booklet.css](app/b/[token]/booklet.css) (globales CSS,
`booklet-`-präfixiert, nur auf dieser Route geladen).

- **Intro:** `intro_bg_url` full-bleed `cover` (Fallback: Verlauf aus
  primary/secondary). Logo (falls `logo_url`), KI-`intro_title` groß,
  `intro_description`, `intro_tagline` (aus Settings) kleiner darunter. Scrim
  (Verlauf) + Text-Shadow garantieren Lesbarkeit. Dezenter, animierter
  Scroll-Indikator (Chevron, `prefers-reduced-motion`-fest).
- **Medien-Sektionen** (eine pro `order_media`, in `sort_order`): **Foto**
  `<img>` full-bleed `cover`/`100dvh` (statisch — Ken-Burns ist Sache des Reels,
  8b). **Video** `<video controls playsInline preload="metadata">`, Poster-Frame
  via `src="…#t=0.1"`, **kein** Auto-Play-on-Scroll im MVP (spart
  IntersectionObserver-Komplexität auf der öffentlichen Seite) — Tap zum
  Abspielen. **Caption-Overlay** unten in der Safe-Zone (`displayCaption`):
  unteres Drittel, ~16 % vom unteren Rand abgehoben (über der IG/TikTok-UI-Zone),
  mit Gradient-Scrim (transparent → dunkel) für Kontrast; `displayCaption == null`
  ⇒ **kein** Overlay, **kein** Scrim. Logo pro Seite **nur** wenn
  `branding.logo_per_page`. `pointer-events: none` am Overlay → Video bleibt
  tappbar.
- **Outro:** `outro_bg_url` `cover` (Fallback wie Intro). Logo, Betriebsname,
  `outro_message`. Kontakt als Pill-Links: `contact_email` (`mailto:`),
  `contact_phone` (`tel:`), `website_url` (`target="_blank" rel="noopener
  noreferrer"`, Protokoll/Host normalisiert). **KEINE** Share-/Review-Buttons
  (Step 9).

Desktop: zentrierte Portrait-Spalte (max 480px) vor dunklem Backdrop — spiegelt
das 9:16-Story-Format.

### web_story_ready

Da der Renderer jetzt existiert, setzt die Generate-Route
([…/generate/route.ts](app/api/portal/orders/[id]/generate/route.ts)) bei
Insert **und** Update nun `web_story_ready = true` (jedes generierte Booklet ist
renderbar — Voraussetzung fürs Senden in Step 9). Der öffentliche Render bleibt
**rein lesend** (kein DB-Write aus dem GET).

### Portal-Vorschau-Link

[app/portal/orders/[id]/page.tsx](app/portal/orders/[id]/page.tsx) lädt im Status
`generated` die `booklets`-Row (`access_token`, AUTHENTICATED Client — RLS lässt
Mitglieder Booklets lesen) und reicht sie an `<GeneratedBanner>`
([generate-controls.tsx](app/portal/orders/[id]/generate-controls.tsx)). Der
Banner zeigt jetzt **„Vorschau öffnen"** (`/b/[token]`, `target="_blank"`,
Primär-Aktion) statt des 8a-1-„Vorschau-Seite folgt"-Platzhalters; „Neu
generieren"/„Wieder bearbeiten" bleiben (auf `btn-outline` gesetzt). i18n:
`generate.previewSoon` entfernt, `generate.openPreview` neu.

### i18n

Booklet-Sprache folgt `booklet.language` (i18n-Layer kennt aktuell nur `de` →
unbekannt ⇒ Default); dynamischer Text (Intro/Captions/Outro) kommt
sprachfertig aus der DB. Nur feste Labels neu: Block `booklet.*`
([lib/i18n/de.ts](lib/i18n/de.ts)) — `scrollHint`, `contactEmail`,
`contactPhone`, `contactWebsite`, `expiredTitle`, `expiredText`.

### Deferred

- **Auto-Play-Video on-scroll** (IntersectionObserver) — spätere Politur.
- **View-/Engagement-Tracking** (`booklet_events`, `viewed_at`) — Step 9/10.
- **Slot-Editor** (pro-Item-Hintergründe/Feinlayout) — nach Step 8.

---

## FFmpeg-Infra-Spike (Schritt 8b-0) — ⚠️ VERWORFEN

> **Status: verworfen, Code vollständig entfernt** (Revert vor 8b-1). Der Spike
> bündelte das ffmpeg-Binary (`ffmpeg-static`, ~78 MB) via
> `outputFileTracingIncludes` + `serverExternalPackages` in die Vercel-Function
> und kopierte es zur Laufzeit nach `/tmp`. Lokaler **Build war grün**, das
> **Vercel-Deploy scheiterte jedoch nach erfolgreichem Build** — der Function-/
> Deployment-Größenrahmen wird durch das gebündelte Binary gesprengt. Entfernt
> wurden: `serverExternalPackages` + `outputFileTracingIncludes` aus
> [next.config.ts](next.config.ts), die Route `…/render-reel-test/`, der
> `<ReelTestButton>`, die Dependency `ffmpeg-static` (inkl.
> `pnpm.onlyBuiltDependencies`) und der i18n-Block `reelTest.*`.

### Lehre für 8b-1 (FFmpeg-Packaging)

**Das Binary NICHT in die Vercel-Function bundlen** — das bricht das Deploy
(Größe), unabhängig davon, dass der Build durchläuft. Stattdessen muss ffmpeg zur
**Laufzeit nach `/tmp` geladen** werden (Download von einer selbst-gehosteten
Quelle; konkrete Quelle TBD). Die übrigen 8b-0-Erkenntnisse (Edge kann kein
`child_process` → `runtime = "nodejs"`; Bundle-FS auf Vercel ist read-only, nur
`/tmp` beschreibbar → `chmod 0o755` aufs Binary; `maxDuration` via Fluid Compute;
Output → `order-media` per `service_role`, `business_id` aus der Order) bleiben für
8b-1 gültig.

---

## FFmpeg-Runtime-Download (Schritt 8b-0v2)

Realisiert die in 8b-0 gezogene Lehre: **das Binary NICHT bundlen**, sondern zur
**Laufzeit nach `/tmp` laden**. Damit bleibt der Vercel-Deploy schlank/grün —
**keine** `next.config`-Änderung (kein `serverExternalPackages`, kein
`outputFileTracingIncludes`), **keine** `ffmpeg-static`-Dependency, **keine**
Migration. Weiterhin reiner **Machbarkeits-Spike**; die provisorische Route
`…/render-reel-test` wird in 8b-1 durch das echte „Reel erstellen" ersetzt.

### Binary-Quelle & Storage (`scripts/upload-ffmpeg.ts`, einmalig)

- **Bucket `assets`** (privat, `public: false`): App-internes Infra-Asset, **kein**
  Mandanten-Datum, **keine** RLS — wird ausschließlich serverseitig über
  `service_role` gelesen. **Bewusst per Script statt SQL-Migration** angelegt
  (`createBucket`, idempotent: „exists"-Fehler ignoriert), weil es nicht in die
  tenant-orientierten Migrationen `0001…` gehört. Der Bucket bleibt damit **außerhalb**
  der Migrations-Nummerierung; nächste Tenant-Migration bleibt `0004`.
- **Gepinnte Quelle:** ffmpeg-static GitHub-Release `b6.1.1`, Asset
  **`ffmpeg-linux-x64.gz`** (~28 MB gz, entpackt ~76 MB; `EXPECTED_GZ_BYTES = 29_354_986`,
  `EXPECTED_BIN_BYTES = 79_826_272`). Das ist ein **statisch** gelinkter Build (John
  Van Sickle) → läuft auf Vercels Amazon Linux ohne glibc-Probleme. **Warum gzip?**
  Das rohe Binary (~76 MB) überschreitet das projektweite Supabase-Storage-Limit
  (Default **50 MB**); die ~28-MB-gz passt darunter — **keine** Dashboard-Einstellung
  nötig. Das Script prüft **gzip-Magic** (`1F 8B`) + erwartete gz-Größe, **entpackt**
  und verifiziert das Ergebnis als **ELF** (`7F 45 4C 46`) + erwartete Größe, und lädt
  die **gz** per `service_role` nach `assets/ffmpeg/linux-x64.gz` (`upsert`). Env aus
  `.env.local` (`SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`)
  über einen minimalen, dependency-freien Loader. Run: `pnpm dlx tsx scripts/upload-ffmpeg.ts`.
  > **Quelle in 8b-1b gewechselt:** b6.1.1 war **ohne** libfreetype/`drawtext`
  > gebaut → ersetzt durch den John-Van-Sickle-Static-Build `6.0.1` (drawtext-fähig).
  > Details s. „FIX: drawtext-fähiges ffmpeg-Binary" (8b-1b).

### Render-Route ([app/api/portal/orders/[id]/render-reel-test/route.ts](app/api/portal/orders/[id]/render-reel-test/route.ts))

- `runtime = "nodejs"` (Edge kann kein `child_process`/Binary), `maxDuration = 300`
  (Fluid Compute — Download + ffmpeg dürfen dauern). Auth wie Generate
  (401/403/404; `business_id` aus der über RLS geladenen Order, **nie** aus dem Body).
- **`ensureFfmpeg()`** — der Kern von v2:
  - **Warme Instanz:** liegt `/tmp/ffmpeg` (ausführbar, `access X_OK`) schon vor ⇒
    Download **überspringen** (Cache über Invocations).
  - **Cold Start:** die **gz** aus `assets/ffmpeg/linux-x64.gz` (`service_role`,
    `storage.download`) laden, zur Laufzeit **entpacken** (`gunzip`) und das Binary
    **atomar** ablegen: Temp-Datei schreiben → `chmod 0o755` → `rename` auf
    `/tmp/ffmpeg`. Das `rename` verhindert, dass ein halb geschriebenes Binary als
    „vorhanden" gecacht wird, wenn zwei Cold-Starts gleichzeitig laden.
  - Fehlschlag ⇒ **500 `ffmpeg_unavailable`** (+ Log; z. B. Asset fehlt / Script
    noch nicht gelaufen).
- ffmpeg wird von `/tmp/ffmpeg` gespawnt → triviales **1080×1920**-mp4 (~2 s,
  `lavfi color`, h264, `yuv420p`, `+faststart`, **kein** Audio), Prozess-Timeout 120 s.
  Output → `order-media` per `service_role` unter `{business_id}/{order_id}/reel-test.mp4`
  (`upsert`, `video/mp4`); Antwort `createSignedUrl(3600)` → `{ ok, url }`.
- **Jeder** Schritt `try/catch` + `console.error` (`order_id`, `step`, `message`)
  mit JSON-Code (`ffmpeg_unavailable`/`ffmpeg_failed`/`upload_failed`/`sign_failed`);
  `finally` räumt nur die **Temp-mp4** auf — **NICHT** `/tmp/ffmpeg` (bleibt gecacht).
  **Kein** `order_media`-Row (Spike).

### UI & i18n

`<ReelTestButton>` ([generate-controls.tsx](app/portal/orders/[id]/generate-controls.tsx))
im Status `generated` am Seitenende → POST → „Test-Reel öffnen"-Link, Lade-/
Fehler-State (`try/finally` + AbortController, 180 s). i18n `reelTest.*`. Provisorisch.

> **Ersetzt in 8b-1a:** `render-reel-test` (Route + `<ReelTestButton>` + `reelTest.*`)
> wurde durch das echte Foto-Reel (`render-reel`) ersetzt; `ensureFfmpeg()` lebt jetzt
> in [lib/reel/ffmpeg.ts](lib/reel/ffmpeg.ts).

---

## Reel-Assembly + Job/Status (Schritt 8b-1a)

Erstes **echtes** Reel: aus den **Fotos** eines generierten Booklets entsteht ein
9:16-Video (1080×1920, **3 s je Foto**, **harte Schnitte**, **ohne Ton**). Der Render
läuft **asynchron** als Hintergrund-Job mit persistentem Status + Poll. Ersetzt die
provisorische `render-reel-test`-Route. **NUR FFmpeg, KEIN Sharp.** KEIN Intro/Outro/
Captions (8b-1b), KEINE Video-Clips (8b-2), KEIN Ken-Burns (8b-3).

### Migration 0004 ([supabase/migrations/0004_reel_status.sql](supabase/migrations/0004_reel_status.sql))

- `booklets.reel_status text NOT NULL default 'pending'` mit Check `in
  ('pending','rendering','ready','failed')` + `booklets.reel_error text` (Diagnose).
  `reel_url` (Storage-Pfad des fertigen Reels) existiert bereits aus 0001.
- **Keine** neue Policy/GRANT: `booklets` ist RLS-aktiv (0001) — die member-Policies
  (`select`/`update` für `authenticated`) und `service_role` (`grant all`) decken die
  Spalten ab. Verify [supabase/verify/0004_reel_status_checks.sql](supabase/verify/0004_reel_status_checks.sql):
  Spalten existieren + Check-Constraint.

### `ensureFfmpeg()` ausgelagert ([lib/reel/ffmpeg.ts](lib/reel/ffmpeg.ts))

Die bewährte Runtime-Download-Logik aus dem 8b-0v2-Spike (gz aus `assets/ffmpeg/
linux-x64.gz` → `gunzip` → atomar nach `/tmp/ffmpeg`, mit Warm-Cache + `access X_OK`)
liegt jetzt **server-only** in `lib/reel/ffmpeg.ts` (`ensureFfmpeg()` + `errMessage()`)
und wird vom echten Render genutzt. `next.config` bleibt unangetastet — das Binary ist
**nicht** gebundlet.

### Render-Endpoint ([app/api/portal/orders/[id]/render-reel/route.ts](app/api/portal/orders/[id]/render-reel/route.ts))

- `runtime = "nodejs"`, `maxDuration = 300`. Auth wie Generate (401/403; Order über RLS
  ⇒ 404). Status muss **`generated`** sein ⇒ sonst **409**. **≥ 1 FOTO**
  (`order_media.media_type='photo'`, RLS) ⇒ sonst **400 `need_photos`** (Clips folgen
  8b-2). **`business_id` AUS DER ORDER**, nie Body.
- **Sofort** `booklet.reel_status='rendering'` (`service_role`, strikt auf die
  Order-`business_id`), `reel_error=null`, dann **202** zurück. Das Booklet existiert
  (Status `generated`); fehlt es ⇒ 500 `no_booklet`.
- Die eigentliche Arbeit läuft in **`after()`** ([next/server], Hintergrund nach der
  Response, innerhalb `maxDuration`): `ensureFfmpeg()` → die Fotos der Order
  (`service_role`, `storage.download`) nach `/tmp` (Original-Extension behalten) →
  **ein** ffmpeg-Aufruf mit `-loop 1 -t 3` je Bild + `filter_complex`
  (`scale=…:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30` ⇒
  **cover**, dann `concat`) → `-pix_fmt yuv420p -c:v libx264 -movflags +faststart -an`
  → `/tmp/reel.mp4` (Prozess-Timeout 240 s). Upload per `service_role` nach
  `order-media` unter `{business_id}/{order_id}/reel.mp4` (`upsert`).
- **Erfolg:** `booklet.reel_url=Pfad`, `reel_status='ready'`, `reel_error=null`.
  **Fehler (jeder Schritt):** `reel_status='failed'`, `reel_error="{step}: {message}"`
  + `console.error(order_id, step, message)`. `finally` räumt nur die **Temp-Fotos +
  reel.mp4** auf — **NICHT** `/tmp/ffmpeg` (bleibt gecacht).

### Status-Poll ([app/api/portal/orders/[id]/reel-status/route.ts](app/api/portal/orders/[id]/reel-status/route.ts))

`GET`, AUTHENTICATED, Order über RLS ⇒ 404. Liest `booklets.reel_status`/`reel_url`
über den **AUTHENTICATED** Client (0002-Policy lässt Mitglieder ihren eigenen Pfad
signieren — **kein** `service_role`). Antwort `{ status, url }` — `url` = frische
`createSignedUrl(reel_url, 3600)` **nur** bei `ready`, sonst `null`.

### UI & i18n

`<ReelButton>` ([generate-controls.tsx](app/portal/orders/[id]/generate-controls.tsx))
im Status `generated`: **opt-in** „Reel erstellen" (Kostenkontrolle) → `POST render-reel`
(202) → `reel-status` alle **~3 s** pollen → `rendering` „Reel wird erstellt…" → `ready`
„Reel ansehen" (Link auf das signierte `reel.mp4`) + „Neu erstellen" / `failed`
Fehlerhinweis + „Erneut". `try/catch/finally`, kein Hängen. Der **Anfangsstatus kommt
vom Server** ([page.tsx](app/portal/orders/[id]/page.tsx) liest `reel_status`/signiert
`reel_url` bei `ready`) — Reload zeigt den persistenten Stand, und ein laufender Render
nimmt den Poll automatisch wieder auf. i18n `reel.*` (ersetzt `reelTest.*`).

---

## Caption-Overlays im Reel (Schritt 8b-1b)

Baut auf 8b-1a auf: pro Foto wird die **Caption** unten in der Safe-Zone **ins
Reel gebrannt** — mute-safe, der Text trägt die Story (kein Ton). **Keine
Migration.** **KEIN** Intro/Outro (8b-1c), **KEINE** Video-Clips (8b-2), **KEIN**
Ken-Burns (8b-3). **NUR FFmpeg, KEIN Sharp.** Status/Job/Upload/Output bleiben
exakt wie 8b-1a (`after()`, `reel_status`, `render-reel`/`reel-status`,
`{business_id}/{order_id}/reel.mp4`).

### Schrift MITGELIEFERT (nicht auf System-Fonts verlassen)

Vercel-Functions haben **keine** System-Fonts und **kein** fontconfig — eine
Suche liefe leer. Deshalb liegt die Schrift **im Repo** und wird **explizit per
Pfad** referenziert:

- [assets/fonts/PlusJakartaSans-SemiBold.ttf](assets/fonts/PlusJakartaSans-SemiBold.ttf)
  (~130 KB, OFL, Lizenz daneben in [assets/fonts/OFL.txt](assets/fonts/OFL.txt))
  — derselbe Font wie die App/Web-Story, Schnitt **SemiBold** (= `font-weight:
  600` der `.booklet-caption`).
- **Tracing:** Next traced die Datei nicht automatisch (kein `import`, nur als
  ffmpeg-Argument). [next.config.ts](next.config.ts) bindet sie + das Scrim per
  **`outputFileTracingIncludes`** gezielt in die `render-reel`-Function ein
  (Glob `/api/portal/orders/*/render-reel` + Bracket-Fallback). Anders als das
  ffmpeg-Binary (8b-0, verworfen) sind das **kleine** Dateien — **kein**
  Deploy-Größenproblem. Verifiziert: die Trace-Datei
  (`.next/.../render-reel/route.js.nft.json`) listet Font + Scrim, **andere**
  Order-Functions nicht.
- Zur Laufzeit relativ zu **`process.cwd()`** (= Function-Root auf Vercel).
  `drawtext` lädt die Schrift via `fontfile=` direkt über libfreetype — **kein**
  fontconfig-Lookup. **Per-Betrieb-Schrift** im Reel ist eine spätere Politur
  (erst EINEN Font sauber zum Laufen bringen).

### Caption-Text

`displayCaption(media)` aus [lib/booklet/caption.ts](lib/booklet/caption.ts)
(`caption ?? keyword`; beide leer ⇒ `null`) — **dieselbe** Quelle wie die
Web-Story, kein Drift. `null` ⇒ **sauberes Foto, kein Scrim, kein Text**.

### Rendering-Ansatz (Variante B: ffmpeg `drawtext`)

Gewählt: **ffmpeg `drawtext` mit `fontfile=`** (kein Sharp/SVG — librsvg bräuchte
ebenfalls fontconfig, derselbe Serverless-Font-Schmerz; `drawtext`+`fontfile`
umgeht das). **Zweistufig** (statt eines großen Filtergraphen — jeder
ffmpeg-Aufruf bleibt simpel und einzeln diagnostizierbar):

1. **Pro Foto ein 1080×1920-PNG-Frame backen** (eigener ffmpeg-Aufruf): cover
   (`scale=…:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1`).
   **Mit Caption** zusätzlich: statisches **Scrim** (transparent→dunkel) drüber
   (`overlay`), **Branding-Akzentbalken** (`drawbox`, `primary_color`) und
   **`drawtext`** (weiß, SemiBold, links-bündig, mehrzeilig, unten in der
   Safe-Zone verankert). **Ohne Caption**: nur cover-crop (sauberes Foto).
2. **Frames zum Reel fügen** (ein ffmpeg-Aufruf): je Frame `-loop 1 -t 3`,
   `setsar=1,fps=30,format=yuv420p` (vereinheitlicht RGB/RGBA der Frames →
   `concat` verlangt EIN Format), **harte Schnitte**, `libx264`/`yuv420p`/
   `+faststart`/`-an` — Encode-Parameter wie 8b-1a.

**Scrim:** statisches
[assets/reel/caption-scrim.png](assets/reel/caption-scrim.png) (1080×1920 RGBA,
~10 KB), vertikaler Verlauf `transparent 0–42% → schwarz 0.72` — **spiegelt die
Web-Story** (`.booklet-caption-scrim`). Bewusst **committet** (Generator
[scripts/make-caption-scrim.mjs](scripts/make-caption-scrim.mjs), reines Node/
zlib) statt zur Laufzeit per `geq` erzeugt: deterministisch, lokal verifizierbar,
als kleines Asset mitgetraced.

**Safe-Zone & Layout** (im 1080×1920-Frame): Text unten, **~16 %** über dem Rand
(`BOTTOM_MARGIN=307`), links-bündig (`SIDE_MARGIN=80` — robust ohne `text_align`,
das es erst in neueren ffmpeg gibt), Fontgröße 52, `line_spacing=12`,
weiß + Schatten (`shadowcolor=black@0.55:shadowy=2`); unten am Block der
Akzentbalken in `primary_color`. **Mehrzeiliger Umbruch** (`wrapCaption`, greedy,
konservatives Zeichen-Limit) für lange Captions (bis ~180 Zeichen) →
Zeilenumbrüche in einer **`textfile`** (kein Filtergraph-Escaping nötig — `:`/`%`/
Umlaute unkritisch; zusätzlich `expansion=none` → Text 1:1). Vertikale Verankerung
über die `drawtext`-Variable `text_h` (`y=h-335-text_h`) — der Block wächst nach
oben, der Boden bleibt in der Safe-Zone.

### Diagnose statt Garbage

Schlägt das Font-Rendering fehl (Schrift nicht getraced / `drawtext` im Build
fehlt), endet der Job sichtbar auf `reel_status='failed'` mit klarem `reel_error`
(eigener Schritt **`font_missing`** = Schrift nicht lesbar; sonst **`bake_frames`**)
— **nie** ein Reel mit leerem/unleserlichem Text. Lokal mit einer arm64-ffmpeg
(8.1.1) gegen Font + Scrim verifiziert: cover-crop, Scrim, Akzentbalken, weiße
mehrzeilige Caption (inkl. Umlaute/`—`) lesbar; Assembly → 6 s, h264/yuv420p,
1080×1920 (DAR 9:16), 30 fps, kein Audio.

### FIX: drawtext-fähiges ffmpeg-Binary (Binary-Wechsel + Selbstcheck)

**Symptom (Vercel-Log):** Der Render scheiterte bei `bake_frames` mit „No such
filter: 'drawtext'". Die Render-Pipeline war korrekt — nur das **Binary** konnte
den Filter nicht: der bisherige Build (`eugeneware/ffmpeg-static` `b6.1.1`) war
**ohne libfreetype** kompiliert, also **ohne** `drawtext`.

**Quelle gewechselt** ([scripts/upload-ffmpeg.ts](scripts/upload-ffmpeg.ts)): statt
b6.1.1 jetzt der **John-Van-Sickle-Static-Build** `ffmpeg-6.0.1-amd64-static`
(die `old-releases/`-URL ist versions-stabil — anders als der bewegliche
`releases/…release…`-Link — daher gepinnt). **Voll ausgestattet**
(`--enable-libfreetype --enable-fontconfig` → `drawtext` vorhanden, im Binary
verifiziert), **statisch** gelinkt → läuft auf Vercels Amazon Linux ohne
glibc-Probleme. Das Script lädt die **`tar.xz`**, prüft **xz-Magic**
(`FD 37 7A 58 5A 00`) + Größe (`EXPECTED_TARXZ_BYTES = 41_164_188`), extrahiert
**nur** das `ffmpeg`-Binary (`tar` — ffprobe verworfen), verifiziert es als **ELF**
(`7F 45 4C 46`) + Größe (`EXPECTED_BIN_BYTES = 78_714_496`), **gzippt** es (Node
`gzipSync`, ~28,9 MB — sicher unter dem **50-MB**-Supabase-Limit, das das Script
zusätzlich prüft) und lädt es per `service_role` nach `assets/ffmpeg/linux-x64.gz`
(`upsert`, überschreibt das alte Binary). Die **Pipeline** (drawtext, Scrim,
Akzentbalken, Font, Frames, Assembly) bleibt **UNVERÄNDERT**.

**Lizenz:** Es ist ein **GPLv3**-Static-Build (`--enable-gpl --enable-version3`).
ffmpeg wird ausschließlich **server-seitig zum Rendern** genutzt und **nicht** an
Endkunden weitergegeben → keine Distribution der Binary, keine Quelltext-
Mitgabepflicht gegenüber Dritten. GPLv3 ist für diesen Server-Render-Einsatz in
Ordnung.

**drawtext-Selbstcheck** ([lib/reel/ffmpeg.ts](lib/reel/ffmpeg.ts)): `ensureFfmpeg()`
führt beim **Cold-Start** (nach `gunzip`, **vor** dem atomaren `rename`) **einmal**
`ffmpeg -hide_banner -filters` aus und verlangt `drawtext` im Listing — fehlt es,
wird das Temp-Binary verworfen und ein klarer **`drawtext_missing`**-Fehler
geworfen (statt erst spät bei `bake_frames` zu scheitern). Da der Check **vor**
dem `rename` läuft, ist das gecachte `/tmp`-Binary **immer** geprüft-gut; warme
Instanzen (Early-Return über `access X_OK`) überspringen ihn — der Check läuft
**einmal pro Instanz**, nicht pro Render.

**Cache versioniert:** Der `/tmp`-Cache-Pfad heißt jetzt **`/tmp/ffmpeg-v2`** (statt
`/tmp/ffmpeg`). So lädt eine warme Instanz, die noch das alte (drawtext-lose)
Binary hält, nach Re-Upload + Re-Deploy **garantiert** neu. Bei künftigen
Binary-Wechseln hochzählen.

### Fallback (falls Vercel zickt)

Sollte `drawtext`/`fontfile` im Vercel-Runtime doch versagen, ist **Variante A**
(Sharp + SVG-Overlay mit **eingebettetem** Font via base64-`@font-face`, dann
Composite) der dokumentierte Ausweg — **erst nach Rücksprache**, nicht still mit
kaputtem Text weiterrendern.

---

## Intro/Outro im Reel (Schritt 8b-1c)

Baut auf 8b-1a/1b auf: das Reel bekommt einen **Intro-** und einen **Outro-Frame**
(je ~2,5 s) mit Logo + Branding + Text — die Marke rahmt die Foto-Story. Foto-Frames
optional mit **Logo-Wasserzeichen**. **Keine Migration**, **keine** UI-/Poll-Änderung
(`after()`/`reel_status`/`render-reel`/`reel-status` unverändert). **KEINE** Video-Clips
(8b-2), **KEIN** Ken-Burns (8b-3). **NUR FFmpeg, KEIN Sharp.**

### Reihenfolge & Assembly

Intro-Frame (2,5 s) → Foto-Frames (je 3 s, 8b-1b) → Outro-Frame (2,5 s), **harte
Schnitte**. Die Assembly (`assembleReel`) nimmt jetzt **pro Frame eine eigene Dauer**
(`-loop 1 -t s` je Input) statt einer globalen Konstante; Encode unverändert
(`libx264`/`yuv420p`/`+faststart`/`-an`, `concat`-Filter, `setsar=1,fps=30,
format=yuv420p` je Input). Upload/Status/Output identisch zu 8b-1a
(`{business_id}/{order_id}/reel.mp4`).

### Filtergraph-Logik ausgelagert ([lib/reel/frames.ts](lib/reel/frames.ts), NEU, server-only)

Die gesamte ffmpeg-Filtergraph-Logik liegt jetzt in `lib/reel/frames.ts` — die
[render-reel-Route](app/api/portal/orders/[id]/render-reel/route.ts) bleibt reine
Orchestrierung (Auth/Status/Downloads/Upload/Cleanup). Exporte: `bakePhotoFrame`,
`bakeIntroFrame`, `bakeOutroFrame`, `assembleReel`, `assertReelAssets`, `REEL_*`. Der
8b-1b-Foto-Pfad (cover-crop + Caption-Overlay) wurde **unverändert** mit übernommen
(gleiche Filter-Substrings), nur um das optionale Wasserzeichen erweitert.

- **Intro-Frame:** Hintergrund = `intro_bg_url` (Bucket `branding`, `service_role`
  download) cover-crop 1080×1920; **fehlt er** ⇒ diagonaler Verlauf aus
  `primary→secondary` über die `gradients`-lavfi-Quelle (reine libavfilter-Quelle,
  in jedem vollständigen Build vorhanden) — spiegelt `.booklet-bg--fallback`.
  **FIX 8b-1c:** der Verlauf nutzt **kein** `:type=linear` mehr (s. u.). Darüber
  der **Vollflächen-Scrim**, dann (falls `logo_url`) das **Logo prominent oben**
  (`overlay`, in **960×340**-Box skaliert — vergrößert ggü. anfangs 720×200, Alpha
  bleibt, weiterhin zentriert), dann **KI-`intro_title`** groß **links-bündig**
  (Fallback Betriebsname), Branding-**Akzentbalken**, die **`intro_description`**
  (1–2 Sätze, links-bündig, kleiner) und **`intro_tagline`** (uppercase,
  `primary_color`) darunter — Reihenfolge **Logo → Titel → Beschreibung → Tagline**.
  **FIX 8b-1c:** `intro_description` ist **zurück im Reel** (war anfangs bewusst weg)
  — sie trägt die persönliche Ich-Story und ist das Herz der Personalisierung; die
  Intro-Frame-Dauer ist dafür **2,5 s → 4 s** angehoben.
- **Outro-Frame:** Hintergrund `outro_bg_url`/Verlauf, Scrim, Logo, **Betriebsname**,
  Akzentbalken, **`outro_message`** und unten in der Safe-Zone **Kontakt** (Telefon
  `contact_phone` + Website `website_url` als Host ohne Protokoll). **KEINE** Share-/
  Review-Elemente (Step 9; das Reel ist eine Datei, kein interaktiver Hub).
- **Foto-Frames:** Captions unverändert (8b-1b). **ZUSÄTZLICH:** bei
  `branding.logo_per_page` ein **dezentes Logo-Wasserzeichen** oben links (`overlay`,
  in **400×116**-Box skaliert — leicht größer als anfangs 320×92, aber bewusst subtil,
  Rand 44 px — analog `.booklet-page-logo`); ohne `logo_per_page` kein Wasserzeichen.
  Das Logo wird **einmal** geladen und sowohl für Intro/Outro als auch das
  Wasserzeichen genutzt.

### Vollflächen-Scrim ([assets/reel/frame-scrim.png](assets/reel/frame-scrim.png))

Der Caption-Scrim (8b-1b) ist **nur unten** — der zentrierte Intro/Outro-Text braucht
einen **vollflächigen** Verlauf. Neues committetes
[frame-scrim.png](assets/reel/frame-scrim.png) (1080×1920 RGBA, ~11 KB), Werte spiegeln
`.booklet-scrim` (`0.5 @ 0% → 0.3 @ 38% → 0.62 @ 100%`), Generator
[scripts/make-frame-scrim.mjs](scripts/make-frame-scrim.mjs) (reines Node/zlib,
deterministisch). Via `outputFileTracingIncludes` ([next.config.ts](next.config.ts))
**zusätzlich** zum Font + Caption-Scrim in die render-reel-Function getraced (klein,
kein Deploy-Größenproblem; Trace verifiziert).

### Schrift & Textausrichtung (Fix: links-bündig wie die Caption)

- Schrift weiterhin **mitgeliefert** + per `fontfile=` referenziert (kein fontconfig),
  `textfile=`/`expansion=none` wie bei der Caption.
- **Intro/Outro-Text ist LINKS-BÜNDIG** (literales `x=SIDE_MARGIN`), Akzentbalken
  ebenso (`drawbox x=SIDE_MARGIN`) — **exakt die Caption-Methode**.

  **Warum (Bugfix):** Ursprünglich war der Text **zentriert** (`drawtext x=(w-text_w)/2`,
  Akzent `drawbox x=(iw-W)/2`). Auf dem **Production-Build (ffmpeg 6.0.1**, John Van
  Sickle Static, s. [scripts/upload-ffmpeg.ts](scripts/upload-ffmpeg.ts)) blieb der
  Intro/Outro-Text dabei **still leer** — Hintergrund + Logo (`overlay`) rendern, der
  drawtext jedoch nicht; die Captions (8b-1b) liefen sauber. Der **einzige** Unterschied
  zur funktionierenden Caption waren die zentrierenden `(…)/2`-Ausdrücke; die Caption
  nutzt ausschließlich **literale x**. Da centered ohne `text_w` nicht geht, ist der
  Text auf die bewährte Caption-Methode (literales, links-bündiges x) umgestellt. Lokal
  mit ffmpeg 8.1.1 (ffmpeg-full) rendern beide Varianten — der Unterschied tritt erst
  auf 6.0.1 auf, daher reproduziert man ihn nur dort. **Das Logo bleibt zentriert**
  (`overlay x=(W-w)/2` rendert auf 6.0.1 nachweislich — es war sichtbar). Nicht
  geändert: Assembly, Reihenfolge, Scrim, Job/Status/Poll.
- **drawtext-Optionsreihenfolge:** `fontfile` steht **nicht** an erster Stelle
  (`textfile` zuerst) — unverändert.

### FIX 8b-1c (2): Verlauf-Fallback (6.0.1) + Intro-Beschreibung zurück + Kunden-Ich-Perspektive

Drei zusammenhängende Korrekturen, **keine** Pipeline-/Assembly-/Reihenfolge-Änderung,
keine Migration.

1. **Verlauf-Fallback auf 6.0.1** ([lib/reel/frames.ts](lib/reel/frames.ts),
   `backgroundInput`): die `gradients`-lavfi-Quelle nutzt **kein** `:type=linear` mehr.
   Die `type`-Option kam erst mit **ffmpeg 6.1**; auf dem Production-Build (6.0.1) crashte
   sie den Filter → Intro/Outro scheiterte für Betriebe **ohne** Intro/Outro-Hintergrundbild
   (das war die in der vorigen FIX-Notiz offen gelassene Baustelle). `linear` ist ohnehin
   der Default, das Weglassen ändert die Optik nicht.
2. **`intro_description` zurück im Reel-Intro** (`bakeIntroFrame`): war in 8b-1c bewusst
   weg, ist aber das Herz der Personalisierung — kommt zurück, Reihenfolge **Logo → Titel
   → Beschreibung → Tagline** (Titel bottom-anchored, hält Titel↔Akzent eng; Beschreibung +
   Tagline darunter top-anchored an festen y). Gleiche bewährte drawtext-Methode wie Titel/
   Caption (literales x, links-bündig). Intro-Frame-Dauer **2,5 s → 4 s**
   ([render-reel-Route](app/api/portal/orders/[id]/render-reel/route.ts), `INTRO_SECONDS`),
   damit die persönliche Story lesbar ist; die Route lädt dafür `booklets.intro_description`
   zusätzlich und reicht sie an `bakeIntroFrame` durch.
3. **Kunden-Ich-Perspektive** ([lib/ai/intro.ts](lib/ai/intro.ts)) — der **Kern**: das
   Intro ist aus der **Ich-Perspektive des teilenden Kunden** geschrieben („Ich habe bei
   {Betrieb} … lassen — …"), geschlechtsneutral, **nicht** als Selbstdarstellung des
   Betriebs — sonst wird es nicht geteilt. `generateIntro` bekommt zusätzlich den
   `businessName` (`businesses.name`, von der [generate-Route](app/api/portal/orders/[id]/generate/route.ts)
   durchgereicht); der System-Prompt nennt den Betrieb beim Namen als **Erlebnis** des
   Kunden. Gilt für `intro_title` (kurz, persönlich) **und** `intro_description` (1–2 Sätze
   Ich-Story), strikt geerdet auf `item_description` + Captions (keine erfundenen Gefühle).
   `ai_context` (8a-1b) bleibt Betriebs-**FACHkontext** und überschreibt die Ich-Perspektive
   **nicht**. Wirkt auf **Web-Story UND Reel** (gemeinsamer Intro-Text); greift nur bei
   **NEU** generierten Intros (gespeicherte `booklets`-Werte bleiben). Lokal mit ffmpeg-full
   verifiziert (Intro/Outro rendern mit Verlauf-Fallback + Beschreibung sauber).

### Render-Status-Anzeige (UI, kosmetisch)

Während `reel_status='rendering'` zeigt der `<ReelButton>`
([generate-controls.tsx](app/portal/orders/[id]/generate-controls.tsx)) unter dem
Button **rotierende Stufentexte** (i18n `reel.stage1…4`, Wechsel alle ~3,5 s, grob an
der Pipeline orientiert: „Bilder werden vorbereitet…" → „Intro & Outro werden
gestaltet…" → „Reel wird zusammengesetzt…" → „Fast fertig…"), die letzte bleibt
stehen. **Rein kosmetisch** (keine echte Telemetrie — der Status kommt weiter nur aus
dem `reel-status`-Poll), verkürzt die gefühlte Wartezeit; ein kleiner Spinner (`spin`-
Keyframe) begleitet sie. Poll-Logik unverändert.

### Diagnose

Pro Schritt eigener `reel_error`-Code: `assets_missing` (Schrift/Scrim nicht lesbar,
z. B. Tracing fehlgeschlagen), `download_assets` (Logo/Hintergrund), `download_photos`,
`bake_intro`, `bake_frames`, `bake_outro`, `ffmpeg` (Assembly), `upload`, `mark_ready`
— `reel_status='failed'` + `console.error` (order_id/step/message), nie ein Reel mit
kaputten Frames.

---

## Video-Clips im Reel (Schritt 8b-2a)

Baut auf 8b-1a/1b/1c auf: das Reel verwebt jetzt **Video-Clips** mit den Fotos —
normalisiert auf 9:16, **stumm**, **interleaved nach `sort_order`**. Fotos + ihre
Captions (8b-1b) und die Intro/Outro-Frames (8b-1c) bleiben **unverändert**. **Keine
Migration**, **keine** UI-/Poll-Änderung (`after()`/`reel_status`/`render-reel`/
`reel-status`/`{business_id}/{order_id}/reel.mp4` identisch). **NUR FFmpeg, KEIN
Sharp.** **KEINE** Clip-Captions/Wasserzeichen (8b-2b), **KEIN** Ken-Burns (8b-3).

### Media laden (Guard: need_photos → need_media)

Die [render-reel-Route](app/api/portal/orders/[id]/render-reel/route.ts) lädt jetzt
**ALLE** `order_media` (Fotos UND Videos), sortiert nach `sort_order` ASC (vorher nur
`media_type='photo'`): `select storage_path, media_type, caption, keyword`. Der Guard
ist von **`need_photos`** auf **`need_media`** umgestellt — **≥ 1 Medium (Foto ODER
Video)** ⇒ sonst **400 `need_media`**. i18n: `reel.needPhotos` → `reel.needMedia`,
`reel.hint` nennt jetzt auch die Clips (bis 6 s).

### Pro Item normalisieren ([lib/reel/frames.ts](lib/reel/frames.ts))

Damit gemischte Medien überhaupt zusammengefügt werden können, bekommt **jedes** Item
**dieselbe kanonische Form** (`CANON_ENCODE`: `libx264` / `yuv420p` / `-an`, 30 fps CFR,
SAR 1:1, 1080×1920):

- **Foto** (`bakePhotoFrame` → `encodeStillSegment`): **unverändert** wie 8b-1b — 3 s-
  Still, cover-crop, Caption-Overlay + optionales Logo-Wasserzeichen. Das gebackene PNG
  wird per `encodeStillSegment` (`-loop 1 -t 3`) zum mp4-Segment encodet.
- **Video** (`normalizeClip`, NEU): den Clip auf die kanonische Form bringen —
  - `scale=…increase,crop=1080:1920,setsar=1` (**cover**; `autorotate` greift VOR den
    Filtern → Hochformat-Handyclips werden korrekt aufgerichtet),
  - `fps=30,format=yuv420p`, `libx264`,
  - **Audio gestrippt** (`-an`) — mute-safe (der Text/die Bilder tragen die Story),
  - **Dauer-Cap** auf **min(Clip-Länge, 6 s)** über `-t 6` als **INPUT-Option** (stoppt
    das Lesen nach 6 s; kürzere Clips laufen bis EOF). `MAX_CLIP_SECONDS = 6` (Tempo; in
    8b-3 konfigurierbar).
  - **NOCH KEINE** Caption/Wasserzeichen auf dem Clip (8b-2b).

### Assembly: concat-Demuxer statt concat-Filter

Die alte `assembleReel` (ein concat-**Filter** über geloopte PNGs) ist durch
`concatSegments` ersetzt. **Reihenfolge: Intro → [Items in `sort_order`: Foto-Stills +
Clip-Segmente gemischt] → Outro**, harte Schnitte. Jedes Item wird zu einem
**formatgleichen Zwischensegment** (mp4) gerendert; die Segmente werden per
**concat-Demuxer** (Dateiliste → `-f concat -safe 0 -i list.txt -c copy -movflags
+faststart`) verlustfrei gefügt.

- **Warum Demuxer + Segmente** statt eines großen concat-Filters mit gemischten
  Image-/Video-Inputs: heterogene Medien gehen nur **format-IDENTISCH** durch concat.
  Der Demuxer mit **`-c copy`** ist genau dafür da, ist schnell (kein Re-Encode) und
  isoliert jeden Schritt (ein defektes Item scheitert einzeln, mit Item-Kontext im
  `reel_error`). **Driften die Segment-Parameter** (Auflösung/pixfmt/codec/fps/SAR),
  **bricht der Demuxer** — `encodeStillSegment`/`normalizeClip` garantieren genau die
  EINE kanonische Form (`CANON_ENCODE`).
- Lokal mit ffmpeg 8.1.1 verifiziert: ein normalisierter **Landscape-Clip mit Audio**
  → 1080×1920, SAR 1:1, yuv420p, 30 fps, **exakt 6 s**, **0 Audio-Spuren**; der
  `-c copy`-concat aus Still+Clip+Still → 1080×1920, yuv420p, 30 fps, **exakt 12 s**,
  kein Audio. (Die concat-Demuxer-/cover-/fps-Filter sind alt + stabil — kein
  6.0.1-spezifischer Stolperstein wie `gradients :type=linear` oder zentrierter
  drawtext; die bleiben aus 8b-1c gefixt und sind hier nicht berührt.)

### Orchestrierung & Diagnose

Die Route bleibt reine Orchestrierung; `after()`/Status/Upload/Output sind identisch zu
8b-1a/1c. Geänderte/neue `reel_error`-Schritte: **`download_media`** (war
`download_photos`; lädt jetzt alle Medien), **`build_segments`** (war `bake_frames`;
Foto-Frame+Encode **oder** Clip-Normalisierung — mit `item {i} ({media_type})`-Kontext),
**`concat`** (war `ffmpeg`). Unverändert: `assets_missing` / `ensure_ffmpeg` /
`download_assets` / `bake_intro` / `bake_outro` / `upload` / `mark_ready`. `pnpm
typecheck` + `pnpm build` grün; Tracing (Font + beide Scrims) unverändert in die
render-reel-Function.

---

## Clip-Captions/Wasserzeichen (Schritt 8b-2b)

Die in 8b-2a noch **nackten** Clip-Segmente bekommen jetzt **dieselbe** Overlay-
Behandlung wie die Foto-Segmente (8b-1b/8b-1c): **Caption-Scrim + Branding-Akzentbalken
+ Caption-drawtext** und das **optionale Logo-Wasserzeichen** (`logo_per_page`) — über
den **Video-Stream** gebrannt. Fotos, Intro, Outro und die gesamte Assembly/Orchestrierung
(`concatSegments`, `after()`, `reel_status`, `render-reel`/`reel-status`, Output-Pfad,
UI/Poll) bleiben **unverändert**. **Keine Migration. NUR FFmpeg, KEIN Sharp.** **KEIN**
Ken-Burns (8b-3).

### Geteilte Overlay-Kette (Foto + Clip, kein Drift)

Verifiziert: die Foto-Captions rendern via **ffmpeg `drawtext`** im `filter_complex`
(Scrim-PNG per `overlay`, Akzent per `drawbox`, Text per `drawtext=textfile=…:fontfile=…`)
— **nicht** Sharp/Canvas. Die Overlay-Erzeugung ist deshalb in einen gemeinsamen Helfer
[`buildCaptionOverlay`](lib/reel/frames.ts) gezogen, den **Foto- (`bakePhotoFrame`) UND
Clip-Pfad (`normalizeClip`)** nutzen — **nicht dupliziert**. Der Helfer nimmt ein
Basis-Stream-Label + den ersten freien Input-Index und liefert `{ extraInputs, parts,
outLabel }` (die `-i`-Inputs Scrim→Logo in genau dieser Reihenfolge, die filter_complex-
Teile, das End-Label). `bakePhotoFrame` erzeugt damit **byte-identische** Filtergraph-
Strings wie zuvor (reines Refactoring, kein Verhaltensänderung); `normalizeClip` hängt
dieselbe Kette an den Video-Stream.

### `normalizeClip`-Erweiterung ([lib/reel/frames.ts](lib/reel/frames.ts))

`normalizeClip` bekommt drei neue Parameter (analog `bakePhotoFrame`): `caption`,
`logoPath`, `primaryColor`.

- **Caption-Text:** `displayCaption(media)` (`caption ?? keyword`; beide leer/Whitespace
  ⇒ `null`) aus [lib/booklet/caption.ts](lib/booklet/caption.ts) — **dieselbe** Quelle
  wie Web-Story und Foto-Frames (kein Drift). `null` ⇒ **kein** Caption-Overlay (wie beim
  Foto: sauberer Clip, kein Scrim).
- **Logo-Wasserzeichen:** wird nur durchgereicht, wenn `branding.logo_per_page` gesetzt
  ist (Gate in der Route, identisch zum Foto), oben links, gleiche Box/Position wie das
  Foto (`WATERMARK_BOX_*`/`WATERMARK_MARGIN`).
- **Schneller Pfad bleibt:** ohne Caption **und** ohne Logo ⇒ das unveränderte 8b-2a-`-vf`
  (`COVER,fps=30,format=yuv420p`). Erst wenn ein Overlay nötig ist, wird der
  `filter_complex`-Pfad genommen.
- **Overlay-Pfad:** `[0:v]COVER,fps=30[base]` → `buildCaptionOverlay` (Scrim/Caption/Logo)
  → `[…]format=yuv420p[v]`, `-map [v]`, `…CANON_ENCODE`. Das `-t maxSeconds` bleibt
  **INPUT-Option** **vor** `-i input` (cappt nur den Clip); Scrim/Logo sind Einzelbild-
  Inputs danach.
- **Statisch über die volle Clip-Dauer** (kein `enable=`): die Scrim-/Logo-PNGs sind
  Einzelbilder, `overlay` (`eof_action=repeat`, Default) hält sie für jeden Frame;
  `drawtext` ohne `enable=` rendert auf jedem Frame. Mute-safe (`-an`).
- **6.0.1-sicher** (wie die Foto-Caption seit 8b-1b/1c, nicht neu erfunden): **literales**
  `x`, **links-bündig**, **keine** zentrierten `(…)/2`-Ausdrücke (der 8b-1c-Crash); Text
  via `textfile`/`fontfile` (**kein** fontconfig), Escaping erledigt die `textfile`
  (`expansion=none`). Reines Anwenden derselben, auf 6.0.1 bewährten drawtext-Bausteine
  auf einen Video- statt Still-Stream.

### Kanonische Form unverändert → concat bleibt heil

Der Overlay-Pfad ändert die **Encode-Parameter nicht**: 1080×1920, yuv420p, h264, 30 fps
CFR, SAR 1:1, **stumm** — `format=yuv420p` als letzter Filter, `CANON_ENCODE` als Output-
Optionen. Damit bleiben Clip-Segmente **format-identisch** zu den Still-Segmenten, und der
**concat-Demuxer (`-c copy`)** fügt weiter verlustfrei. Die Route ([render-reel](app/api/portal/orders/[id]/render-reel/route.ts))
reicht im Video-Zweig `caption: displayCaption(item)`, `logoPath: logoPerPage ? logoLocal
: null` und `primaryColor` durch — exakt wie der Foto-Zweig.

Lokal mit ffmpeg-full 8.1.1 verifiziert: Landscape-Clip-mit-Audio → Overlay-Pfad → 1080×1920,
SAR 1:1, yuv420p, 30 fps, **exakt 6 s, 0 Audio-Spuren**, Caption (inkl. Umlaute/`—`) +
Akzentbalken + Logo sichtbar eingebrannt; `-c copy`-concat Still+Clip-Overlay+Still →
**12 s**, durchgängig 1080×1920/yuv420p/30 fps. `pnpm typecheck` + `pnpm build` grün;
Tracing (Font + beide Scrims) unverändert.

---

## Intro-Frame-Layout robust (Schritt 8b-2c)

Behebt den **Überlapp** zwischen KI-Beschreibung und Settings-Tagline im Reel-**Intro**
([bakeIntroFrame](lib/reel/frames.ts)). Reines Layout — **keine** Migration, **keine**
Pipeline-/Assembly-/Reihenfolge-Änderung, **Web-Story unverändert** (sie nutzt weiter die
volle Beschreibung). Betrifft nur das Intro-Frame, nicht Foto-/Clip-/Outro-Frames.

**Problem:** Reihenfolge Logo → Titel → Beschreibung (KI, variabel lang) → Tagline
(Settings). Beschreibung war top-anchored (`y=952`), Tagline an festem `y=1240` direkt
darunter → eine lange Beschreibung wuchs in die Tagline-Zone (feste y + variabler Text).

**Fix (zwei entkoppelnde Maßnahmen):**

1. **Tagline FEST nahe dem unteren Rand gepinnt** statt darunterfließend: `TAGLINE_TOP`
   (1240, top-anchored) → `TAGLINE_BOTTOM` (1760, **bottom-anchored** via `y=${TAGLINE_BOTTOM}-text_h`).
   Damit ist die Tagline-Position von der Beschreibungslänge **entkoppelt**.
2. **Beschreibung NUR fürs Reel-Intro gekürzt** (`truncateForIntro`,
   `REEL_DESCRIPTION_MAX_CHARS = 140` ≈ ≤ 4 gewrappte Zeilen): am letzten Wortende vor dem
   Limit schneiden (kein abgehacktes Wort), Satz-/Trennzeichen am Ende strippen, „…"
   anhängen; kurze Beschreibungen bleiben unverändert. Die in `booklets` gespeicherte
   `intro_description` wird **NICHT** angefasst — nur die Render-Kopie wird gekürzt, die
   Web-Story zeigt weiter die volle Länge.

Mit beidem endet die (gekürzte) Beschreibung weit oberhalb der unten gepinnten Tagline →
**kein Überlapp**, egal wie lang die KI-Ausgabe ist. **Leere Blöcke unverändert sauber**
(bestehende `if (description)`/`if (tagline)`-Guards): fehlt einer, entsteht durch die
festen Positionen **keine Geisterlücke**. **6.0.1-sicher** beibehalten: literales `x`,
links-bündig, `textfile`/`fontfile`, keine zentrierten Ausdrücke. `pnpm typecheck` +
`pnpm build` grün.

---

## Medien-Anzahl-Limit (Schritt 8c)

Pro-Betrieb-Limit für die **Anzahl** Fotos/Videos je Auftrag, unter einem harten
**Plattform-Ceiling**. **Keine Migration** — die Keys liegen im bestehenden
`businesses.settings`-jsonb (wie 5a/7b/8a-1b). Drei Ebenen: Settings (Einstellung),
Capture (UX-Sperre) und Server-Guard (harter Riegel).

### Ceiling-Logik ([lib/settings/options.ts](lib/settings/options.ts))

`PHOTO_COUNT = { min: 1, max: 20, default: 10 }`, `VIDEO_COUNT = { min: 1, max: 10,
default: 3 }`. **`max` ist das Plattform-Ceiling** (Kostenschutz; wandert später ins
Admin-Portal), der pro-Betrieb konfigurierte Wert ist die Einstellung **darunter**
(`default`). Exakt dieselbe Konstruktion wie `VIDEO_SECONDS` — eine geteilte Quelle für
Defaults beim Lesen, Client-Validierung und Server-Validierung.

### Datenmodell ([lib/auth/current-business.ts](lib/auth/current-business.ts))

`BusinessSettings` + `normalizeSettings` um `photo_max_count`/`video_max_count` erweitert:
aus dem jsonb gelesen, auf `[min..Ceiling]` geclamped, Default bei fehlend/ungültig
(`Math.min(Math.max(round(v), min), max)` — kein `any`, gleiches Muster wie
`video_max_seconds`).

### Settings-Form + Route

- [settings-form.tsx](app/portal/settings/settings-form.tsx): in der bestehenden
  „Aufnahme"-Gruppe (wo die Video-Länge sitzt) zwei `RangeNumberField` „Max. Fotos pro
  Auftrag" + „Max. Videos pro Auftrag" (Range-Slider + gekoppeltes Zahlenfeld). Client-
  Validierung deckt sich mit dem Server (`1..Ceiling`).
- [settings/route.ts](app/api/portal/settings/route.ts) (`PATCH`): `photo_max_count ∈
  [1,20]` / `video_max_count ∈ [1,10]` über `intInRange` ⇒ sonst **400**
  (`invalid_photo_count` / `invalid_video_count`); beide Werte fließen in den bestehenden
  settings-**READ-MERGE-WRITE** (überschreiben nichts anderes). `business_id` weiter
  **nur** aus der Session.

### Enforcement im Capture (UX-Sperre)

Die Detailseite [page.tsx](app/portal/orders/[id]/page.tsx) zählt die geladenen
`order_media` getrennt nach `media_type` (`photoCount`/`videoCount`) und reicht sie mit
`photoMax`/`videoMax` (aus `business.settings`) an [capture.tsx](app/portal/orders/[id]/capture.tsx).
Dort werden die Foto-Buttons (Aufnehmen **und** Hochladen) **deaktiviert** (grau,
`pointer-events: none`, `aria-disabled`, `tabIndex -1`) + erklärender Hinweis
(`capture.limitReached`, `{type}`/`{max}`), sobald
`photoCount + in-flight-Foto-Queue-Items ≥ photoMax` (analog Video). **In-flight** = die
optimistischen Queue-Items des jeweiligen Typs, damit nicht mehr eingereiht wird, als
Slots frei sind (man könnte sonst 5 auf einmal starten, obwohl nur 1 Slot frei ist).

### Server-Guard (Wahrheit, [media/route.ts](app/api/portal/orders/[id]/media/route.ts))

Vor dem Insert werden die vorhandenen `order_media` des jeweiligen `media_type` dieser
Order gezählt (`select("id", { count: "exact", head: true })`); `≥
business.settings.{photo,video}_max_count` ⇒ **400 `limit_reached`** + `console.error`.
**Das ist der harte Riegel** — der Client-Disable ist nur UX und umgehbar; `business.settings`
ist bereits auf `[min..Ceiling]` normalisiert (`getCurrentBusiness`).

### i18n

`settings.photoMaxCount`/`videoMaxCount` (+ `*Hint`), `settings.errPhotoCount`/
`errVideoCount`, `capture.limitReached`/`photosLabel`/`videosLabel`.

---

## Reel-Status in der Auftragsliste (Schritt 8d)

Die Auftragsliste zeigte bisher nur `order.status`. Sie zeigt jetzt **zusätzlich** den
`booklets.reel_status`, damit „Reel fehlt" auf einen Blick erkennbar ist. **Keine
Migration** (`reel_status` existiert aus 0004).

### Zwei Achsen (bewusst getrennt)

- **`order.status`** — der **Lifecycle** des Auftrags (`draft → finalized → generated →
  sent → viewed → shared`), dargestellt durch das bestehende
  [order-status-badge.tsx](components/order-status-badge.tsx).
- **`booklets.reel_status`** — der **Render-Zustand** des Reels (`pending`/`rendering`/
  `ready`/`failed`), dargestellt durch die neue Pill. Diese Achse ist **nur im
  Auftrags-Status `generated`** sinnvoll: ein Booklet existiert (sonst gäbe es keinen
  `reel_status`), ist aber noch **nicht versendet** — genau das Fenster, in dem ein
  fehlendes Reel relevant ist.

### Daten ([app/portal/orders/page.tsx](app/portal/orders/page.tsx))

Nach der Order-Query eine **zweite Query** auf `booklets` (`select("order_id,
reel_status")`, `.in("order_id", generatedIds)`) über den **AUTHENTICATED Server-Client**
— `booklets` sind member-lesbar (RLS), **kein** `service_role`. Geladen wird nur für die
Aufträge im Status `generated` (sonst gar nicht); das Ergebnis wird zu einer
`Map<order_id, reel_status>` reduziert, aus der die Zeile per `?? null` liest.

### Anzeige ([components/reel-state-pill.tsx](components/reel-state-pill.tsx))

`<ReelStatePill>` — reine Präsentation (Server-Component-fähig, Muster wie
`order-status-badge.tsx`), in der Zeile **neben** dem Status-Badge (gemeinsamer
wrap-Flex). Die Liste rendert sie **ausschließlich** bei `order.status === 'generated'`;
`draft`/`finalized` (noch kein Booklet) und `sent`/`viewed`/`shared` (bereits
ausgeliefert) bekommen **keine** Pill. Zustände:

| `reel_status` | Label | Farbe |
| --- | --- | --- |
| `pending` / `null` | „Reel fehlt" | **Amber/Warnung — aufmerksamkeitsstark** (der Kern) |
| `rendering` | „Reel rendert …" | Blau |
| `ready` | „Reel fertig" | Grün |
| `failed` | „Reel fehlgeschlagen" | Rot |

Der `ReelStatus`-Typ bleibt **eine Quelle** (definiert in
[generate-controls.tsx](app/portal/orders/[id]/generate-controls.tsx), über die Pill
re-exportiert). Die Farb-Tokens `--amber-*`/`--blue-*`/`--red-*` ([globals.css](app/globals.css))
sind analog zu den `--green-*`-Tokens (6c) angelegt; Grün wird wiederverwendet.

### i18n

`orderStatus.reelMissing`/`reelRendering`/`reelReady`/`reelFailed`. Keine Inline-Strings.

---

## Share-Sheet auf der Web-Story (Schritt 9a)

Die öffentliche Web-Story [/b/[token]](app/b/[token]/page.tsx) bekommt ihre **Teilen-Mechanik** — der WOM-Kern: Reel als **Datei**, Story als **URL**, WhatsApp-Deeplink, Link kopieren, Download-Fallback. **Keine Migration.** **KEINE** Review-/IG-Caption-Aktionen (das ist 9b), **KEIN** View-/Analytics-Tracking (Step 9/10 später).

### Daten ([app/b/[token]/page.tsx](app/b/[token]/page.tsx) bleibt Server Component)

- **Reel signieren:** Der Lader [lib/booklet/load.ts](lib/booklet/load.ts) liest jetzt zusätzlich `booklets.reel_status` + `reel_url`. Ist `reel_status === 'ready'` **und** `reel_url` gesetzt, wird der Reel-Pfad (Bucket `order-media`, `{business_id}/{order_id}/reel.mp4`) **server-seitig per `service_role`** signiert — im **selben Batch** wie die Medien (`signPaths`, ein Round-Trip), Ablauf 3600 s. Sonst `null`. Neues Feld `PublicBookletData.reelSignedUrl: string | null`. **Token bleibt die einzige Vertrauensquelle** (§14.2): alle Reads strikt auf die `business_id`/`order_id` der Booklet-Row gescoped.
- **Kanonische Story-URL:** Die Page leitet die absolute `/b/[token]`-URL aus den Request-Headern ab (`x-forwarded-host` ?? `host`, `x-forwarded-proto` ?? `https` — auf Vercel gesetzt); die Seite ist ohnehin `force-dynamic`.
- Beides geht als Props (`storyUrl`, `reelSignedUrl`, `locale`) an die neue Client-Komponente `<ShareBar>` (gerendert im **Outro**, nach der Abschiedsnachricht, vor den Kontakt-Pills).

### Client-Komponente ([app/b/[token]/share-bar.tsx](app/b/[token]/share-bar.tsx), `"use client"`)

**SSR-sicher** — `window`/`navigator` werden **nur** in Handlern/Effects berührt, nie beim Render. Buttons sind `div + onClick` (kein `<form>`), via Helfer `<Pressable>` mit `role="button"` + Enter/Space-Tastatur. Reihenfolge wie Pflichtenheft §4: **Reel teilen → Story teilen → WhatsApp → Link kopieren.**

- **„Reel teilen" (nur wenn `reelSignedUrl` gesetzt):** `fetch(reelSignedUrl)` → `new File([blob], "reel.mp4", {type:"video/mp4"})`; wenn `navigator.canShare({files})` **und** `navigator.share` → `navigator.share({ files, title })` (öffnet den IG/TikTok-Composer), sonst **Download-Fallback** (Anchor mit `download`-Attribut). Ladezustand während Fetch/Share; **Abbruch durch den Nutzer = kein Fehler** (kein Toast). Eine Capability-Probe im `useEffect` (Dummy-`File` an `canShare`) entscheidet **optimistisch** über das Label: kann teilen ⇒ „Reel teilen", sonst ⇒ „Reel herunterladen". Ist `reelSignedUrl` `null`, wird der Button **gar nicht** gerendert (die Seite ist dann bewusst „kastriert", kein Platzhalter-Fake).
- **„Story teilen" (URL):** `typeof navigator.share === "function"` → `navigator.share({ url, title, text })`, sonst Fallback = Link kopieren.
- **„WhatsApp":** Deeplink `https://wa.me/?text=<encodeURIComponent(message + " " + storyUrl)>` via `window.open(..., "_blank", "noopener,noreferrer")`.
- **„Link kopieren":** `navigator.clipboard.writeText(storyUrl)` → kurzer „✓ Link kopiert"-Flash (~2 s, Timer im `useRef`, beim Unmount geräumt).

### Platzierung & Stil ([app/b/[token]/booklet.css](app/b/[token]/booklet.css))

Prominente Teilen-Sektion im **Outro**, mobile-first, Valooro-Branding (dieselben `--bk-*`-Tokens wie die Web-Story). **„Reel teilen" optisch als Hauptaktion** (`.booklet-share-primary`, `--bk-primary`-Fläche, prominent), Story/WhatsApp/Link als gleich breite Outline-Kacheln (`.booklet-share-row`/`.booklet-share-btn`). Weil das Outro jetzt zusätzlich die Teilen-Buttons trägt, darf es über `100dvh` **hinauswachsen**: `.booklet-section--outro` schaltet von fixem `height: 100dvh; overflow: hidden` auf `min-height: 100dvh; height: auto; overflow: visible` (Snap-Punkt bleibt am oberen Rand) — die full-bleed Medien-Sektionen bleiben unverändert bei 100dvh.

### i18n

Neuer Block `share.*` in [lib/i18n/de.ts](lib/i18n/de.ts): `heading`, `shareReel`, `download`, `shareStory`, `whatsapp`, `copyLink`, `copied`, `sharing` sowie `shareTitle`/`message` (Titel + kurzer Text für `navigator.share`/WhatsApp, Kunden-Perspektive). Labels über `t(locale, "share.…")`, `locale` aus `booklet.language` (Fallback `de`). Keine Inline-Strings.

---

## Review-Entwurf (Sonnet) + IG-Caption auf der Web-Story (Schritt 9b)

WOM-Verstärker: ein personalisierter **Google-Review-Entwurf** + ein **IG-Caption-Vorschlag**. Beide werden **bei der Booklet-Generierung erzeugt und im Booklet gespeichert** — die öffentliche Seite [/b/[token]](app/b/[token]/page.tsx) bleibt damit **KI-frei** (kein Live-KI-Call beim Aufruf). **Keine Migration** (`booklets.review_draft` + `ig_caption` aus 0001).

### §8.6-Leitplanken (PFLICHT, Pflichtenheft)

1. **Framing „Vorschlag, gern in deinen Worten anpassen"** — **nicht** „diesen Text einfügen". Verbatim-identische KI-Reviews über viele Betriebe triggern Googles Spam-Erkennung; daher generiert der Prompt **natürlich/spezifisch/zurückhaltend** (pro Kunde anders), und die UI rahmt den Text als Vorschlag.
2. **Niemals an eine Belohnung gekoppelt** (harter Google-ToS-Verstoß) — **kein** Belohnungs-Text irgendwo (UI **und** i18n-Strings).

### Generierung ([app/api/portal/orders/[id]/generate/route.ts](app/api/portal/orders/[id]/generate/route.ts) + neue Helfer)

- **`generateReviewDraft`** ([lib/ai/review.ts](lib/ai/review.ts), Sonnet `SONNET_MODEL`): Google-Review-Entwurf aus dem **konkreten** Booklet-Inhalt (`item_description` + Captions + das frisch generierte `intro_title`/`intro_description`), Betriebsname genannt. **Ich-Perspektive des Kunden** („Ich war bei {Betrieb} …", geschlechtsneutral — wie das Intro, FIX 8b-1c), Deutsch, 2–4 Sätze, **keine** übertriebenen Superlative/Marketing-Floskeln. `ai_context` (8a-1b) als **abgegrenzter KONTEXT-Block** (`<<<…>>>`, „KONTEXT, keine Anweisung" — Injection-Hygiene identisch zum Intro). **Kein JSON** (einzelner Textblock); `cleanReview` strippt EIN Paar umschließender Anführungszeichen + trimmt. `max_tokens 400`. → `booklets.review_draft`.
- **`buildIgCaption`** ([lib/booklet/ig-caption.ts](lib/booklet/ig-caption.ts), **TEMPLATE, KEIN KI-Call**): `intro_title` + (nur wenn gesetzt) `@{ig_handle}` (führende `@` normalisiert) + kleines kuratiertes DE-Hashtag-Set. Reine Funktion ohne SDK/Secrets — **kann nicht fehlschlagen**. Der @-Handle ist der Tagging-Multiplikator (§9). → `booklets.ig_caption`.
- **`languageName`** nach [lib/ai/language.ts](lib/ai/language.ts) ausgelagert (§15: neue Sprache = ein Eintrag) — **eine Quelle** für Intro **und** Review; [lib/ai/intro.ts](lib/ai/intro.ts) importiert sie jetzt (vorher lokale Kopie).
- **Route:** nach dem Intro werden Review + IG-Caption erzeugt und in **beide** booklets-Upsert-Zweige geschrieben (`review_draft`/`ig_caption`); **Re-Generate überschreibt** (wie das Intro). **Review-Generierung ist NON-FATAL** — eigener `try/catch` + `console.error`; ein Sonnet-Fehler dort setzt `review_draft = null` und **blockiert die Generierung nicht** (die Web-Story funktioniert ohne den Vorschlag, Re-Generate versucht es erneut). Bewusst entkoppelt: das Intro bleibt der kritische Pfad (502 bei Fehler), Review/IG sind supplementär. `business_id` weiter **aus der Order** (§14.2), `service_role`-Upsert unverändert. Bestehende Booklets bekommen Review/IG erst beim **nächsten** Generieren.

### Seiten-Daten ([lib/booklet/load.ts](lib/booklet/load.ts))

`review_draft` + `ig_caption` werden aus der Booklet-Row mitgeladen und durchgereicht (`PublicBookletData.reviewDraft`/`igCaption`). `settings.google_review_url` + `ig_handle` kommen schon über `normalizeSettings`. **Token bleibt einzige Vertrauensquelle** (§14.2), `service_role` nur server-seitig.

### Web-Story-UI ([app/b/[token]/share-bar.tsx](app/b/[token]/share-bar.tsx), im Outro)

Die 9a-Client-Komponente `<ShareBar>` wird **erweitert** (DRY — kein zweiter Client; geteiltes `copyText`/`flashCopied`/`<Pressable>`, weiterhin SSR-sicher). Neue Props `reviewDraft`/`googleReviewUrl`/`igCaption`; ein einzelner `copiedKey`-State (`"link" | "ig" | "review"`) ersetzt das 9a-`copied`-Boolean (immer nur ein „✓ kopiert"-Flash aktiv).

- **IG-Caption** — nur wenn `igCaption` vorhanden — als Panel **nahe „Reel teilen"** (`.booklet-ig`): Label + `white-space: pre-line`-Text + „Caption kopieren". Der Kunde kopiert sie, um sie beim IG-Post einzufügen.
- **„Google-Bewertung schreiben"** — nur wenn `googleReviewUrl` **UND** `reviewDraft` vorhanden — **unter** dem Share-Sheet (`.booklet-review`): Klick → `review_draft` in die Zwischenablage (zuerst, das Dokument ist hier noch fokussiert ⇒ zuverlässig) → `google_review_url` im neuen Tab (`window.open(..., "_blank", "noopener,noreferrer")`, Protokoll-Guard). Persistenter **Hinweis** „Vorschlag — pass ihn gern in deinen Worten an." (§8.6 #1). **Kein** Belohnungs-Text (§8.6 #2).
- `div + onClick`, Valooro-Branding (`--bk-*`-Tokens wie 9a); Stile in [app/b/[token]/booklet.css](app/b/[token]/booklet.css) (`.booklet-ig*`, `.booklet-review*`).

### i18n

Neue Blöcke in [lib/i18n/de.ts](lib/i18n/de.ts): `review.*` (`button`, `hint` „in deinen Worten", `copied`) + `igCaption.*` (`label`, `copy`, `copied`), über `t(locale, …)` mit `locale` aus `booklet.language` (Fallback `de`). **Kein** Belohnungs-Text in den Strings. Keine Inline-Strings.

---

## Teilen-Sektion nur für den Kunden (Schritt 9d)

Die Teilen-Aktionen (9a/9b) erscheinen **nur auf dem ausgelieferten Link** (der Kunde, der das Booklet bekommt) — **nicht** auf dem **geteilten** Link (die Empfänger, denen der Kunde die Story schickt). Unterschieden wird über einen **URL-Marker**, **nicht** über Share-State: **kein** `first_shared_at`, **keine** DB-Spalte, **keine Migration**.

### Marker = UI-Schalter, KEIN Auth-Gate

- **`?c=1`** schaltet die Kunden-Sicht ein. Quelle/Guard liegen geteilt in [lib/booklet/customer-view.ts](lib/booklet/customer-view.ts): `CUSTOMER_VIEW_PARAM`/`CUSTOMER_VIEW_VALUE`, `CUSTOMER_VIEW_QUERY` (`"c=1"`, an Links gehängt) und `isCustomerViewParam(searchParams)` — **eine** Quelle für Lesen (Seite) und Schreiben (Vorschau-Link). Plain-Modul ohne `service_role`/Secrets → auch im Client importierbar.
- **WICHTIG (§14.2):** Der Marker ist **kein Sicherheits-Gate**. Der `access_token` bleibt der **alleinige** Zugriffsschutz; der Marker schaltet **ausschließlich UI**. **Kein DB-Zugriff** hängt daran (`loadPublicBooklet` ist unverändert, der Marker fließt nirgends in eine Query).

### Sichtbarkeit ([app/b/[token]/page.tsx](app/b/[token]/page.tsx), Server Component)

Die Seite liest jetzt zusätzlich `searchParams` (Next-15-`Promise`) → `isCustomerView = isCustomerViewParam(...)` → Prop an `OutroSection`:

- **`isCustomerView = true`** (Kunde, markierter Link): normales Outro **+ volle Teilen-Sektion** (`<ShareBar>`: Reel/Story/WhatsApp/Link + IG-Caption + Google-Bewertung, 9a/9b **unverändert**).
- **`isCustomerView = false`** (Empfänger, nackter Link): **NUR** `<ShareBar>` wird weggelassen (`{isCustomerView ? <ShareBar … /> : null}`). Das **normale Settings-Outro** (Logo, `outro_message`, Website/E-Mail/Telefon-Pills) bleibt **exakt** wie definiert — sonst ändert sich nichts. Intro + Medien-Sektionen sind in beiden Sichten identisch.

### Share teilt die NACKTE URL

`storyUrl` (kanonisch aus den Request-Headern) wird bewusst **ohne** Marker gebaut (`/b/[token]`, kein `?c=1`). „Story teilen", „Link kopieren" und WhatsApp in [share-bar.tsx](app/b/[token]/share-bar.tsx) teilen damit **immer** die nackte URL → jeder Empfänger landet automatisch in der **Empfänger-Sicht** (keine Teilen-Schicht). `share-bar.tsx` selbst ist unverändert (es bekam schon immer die nackte `storyUrl`).

### Vorschau-Link (Test-Zugang vor 9c)

Der Portal-Vorschau-Link im Status `generated` ([generate-controls.tsx](app/portal/orders/[id]/generate-controls.tsx)) hängt den Marker an (`/b/${token}?${CUSTOMER_VIEW_QUERY}`), damit der Betrieb in der Vorschau die **volle Kunden-Sicht** sieht. (Den ausgelieferten Kunden-Link mit Marker erzeugen E-Mail/QR in **9c**.)

---

## Ausliefern — sent + Billing + E-Mail (Schritt 9c-1)

Der **manuelle Auslieferungs-Pfad**: ein generierter Auftrag wird ausgeliefert → Status `generated → sent`, ein **Billing-Event** wird geschrieben und eine **E-Mail** mit dem Booklet-Link an den Kunden gesendet. **Keine Migration** (Spalten/Tabellen aus 0001: `orders.status`, `booklets.sent_at`, `billing_events`). Die **QR-Druckansicht** ist 9c-2; **View-/Share-Analytics** (`booklet_events`) und die Status-Stufen `viewed`/`shared` bleiben offen.

### Setup

- Dependency `resend` (pnpm; reines JS-Paket, **kein** Lifecycle-Script → **nicht** in `pnpm.onlyBuiltDependencies`).
- Env: `RESEND_API_KEY` (server-only, **nie** `NEXT_PUBLIC`) und **neu** `BOOKLET_BASE_URL` (öffentliche Booklet-Domain für den E-Mail-Link, z. B. `https://b.valooro.com`) — beide in [.env.example](.env.example).

### E-Mail-Schicht ([lib/email/](lib/email/), server-only)

- [lib/email/resend.ts](lib/email/resend.ts): lazily gecachter Resend-Client (`getResend()`, Key **nur** aus `RESEND_API_KEY`) + `isEmailConfigured()` — Muster wie [lib/ai/anthropic.ts](lib/ai/anthropic.ts).
- [lib/email/booklet-email.ts](lib/email/booklet-email.ts): `sendBookletEmail({ to, customerName, businessName, bookletUrl, replyTo? })`. **Absender** `"{Betrieb}" <hello@valooro.com>` (valooro.com ist die verifizierte SPF/DKIM-Domain; der Betriebsname ist nur der **Anzeigename**, RFC-5322-sicher gequotet, header-brechende Zeichen entfernt). **reply-to** = die öffentliche Betriebs-`contact_email` (falls gesetzt) → der Kunde antwortet an den Betrieb, nicht an Valooro. Inhalt DE, bewusst **rich** für Deliverability (nicht nur nackter Link): personalisierter Betreff („Ihr Booklet von {Betrieb}"), Anrede mit `customerName`, ein Satz Kontext, Link als beschrifteter **Button** „Booklet ansehen" + Klartext-Fallback, kurze Signatur. **HTML + Plaintext** (Tabellen-Layout, Inline-Styles; Name/Betrieb/URL HTML-escaped). i18n-ready (MVP de; `order.language` speist später einen Locale-Parameter).

### Link-Bau

`bookletUrl = ${BOOKLET_BASE_URL}/b/${access_token}?${CUSTOMER_VIEW_QUERY}` — mit **`?c=1`** (Kunden-Sicht, `CUSTOMER_VIEW_QUERY` aus [lib/booklet/customer-view.ts](lib/booklet/customer-view.ts) wiederverwendet, 9d). Ist `BOOKLET_BASE_URL` leer, fällt die Route auf den **Origin des Requests** zurück (dev: Portal + Booklet teilen den Host).

### Route Handler ([app/api/portal/orders/[id]/deliver/route.ts](app/api/portal/orders/[id]/deliver/route.ts), `POST`)

- AUTHENTICATED Client; kein User ⇒ **401**, kein Betrieb ⇒ **403**. Order über RLS (fremde/fehlende id ⇒ **404**). **`business_id` NUR aus der geladenen Order** (Session-Betrieb, §14.2), nie aus dem Body.
- **Guard:** `order.status` muss `generated` sein (Booklet existiert) ⇒ sonst **409**. Booklet (`access_token`) über RLS laden ⇒ fehlt ⇒ **500 `no_booklet`** (bei `generated` nie zu erwarten).
- **Ablauf:** (1) `orders.status → sent` (AUTHENTICATED, **defensiv `.eq('status','generated')`** → kein Doppel-Versand bei Races; ein zweiter Klick trifft 0 Zeilen) ⇒ Fehler ⇒ 500 `status_failed`. (2) `booklets.sent_at = now()` (AUTHENTICATED, `booklets_update`) — **nicht-blockierend** (nur geloggt). (3) **Billing-Event** `event_type 'booklet_sent'` (`business_id`/`booklet_id`/`order_id`) — über **`service_role`**, weil `billing_events` für `authenticated` **kein INSERT-Grant** hat (0001: nur SELECT, „Schreiben serverseitig"); `business_id` aus der Order. **Nicht-blockierend** (laut geloggt → Abrechnung manuell nachziehbar). (4) **E-Mail** nur wenn `customer_email` vorhanden; **NICHT-BLOCKIEREND** — ein Fehlschlag setzt `emailFailed:true`, `sent` steht trotzdem.
- **Hinweis zur Spec:** Die ursprüngliche Vorgabe „alles AUTHENTICATED" trifft nicht zu — der Billing-Event-Insert **muss** über `service_role` laufen (RLS lässt keinen `authenticated`-INSERT auf `billing_events` zu). Status-/`sent_at`-Updates bleiben AUTHENTICATED.
- **Response:** `{ sent:true, emailSent:bool, emailFailed?:true }`.

### UI ([app/portal/orders/[id]/deliver-controls.tsx](app/portal/orders/[id]/deliver-controls.tsx) + [page.tsx](app/portal/orders/[id]/page.tsx))

- `<DeliverButton>` (Status `generated`, am Seitenende, **die finale Aktion** nach Reel): prominenter „Booklet ausliefern" (`btn-gold capture-btn`, mobil groß; Muster wie `FinalizeButton`/`GenerateButton`). **Bestätigungsdialog** (`window.confirm`) mit **bewussten Warnungen, KEIN harter Block:** `reel_status != 'ready'` ⇒ „Das Reel ist noch nicht fertig. Trotzdem ausliefern?"; keine `customer_email` ⇒ „Keine E-Mail hinterlegt — Auslieferung per QR (folgt)." Bestätigen → `POST deliver` (AbortController-Timeout) → `router.refresh()`. `emailFailed` ⇒ einmaliger `window.alert` (nach dem Refresh ist der Button weg; die Auslieferung gilt trotzdem als erfolgt). Props `hasEmail`/`reelReady` aus der Seite (`reelStatus === 'ready'`).
- `<DeliveredBanner>` (Status `sent`, am Seitenkopf): grünes Banner „Ausgeliefert am {Datum}" (`--green-*`-Tokens, 6c) + **Vorschau-Link** (`/b/[token]?c=1`, neuer Tab) — Ansehen bleibt. Status `sent` ist **read-only**: `isDraft=false` ⇒ Capture ausgeblendet, `<MediaList readOnly>`, keine Finalize-/Generate-/Reel-/Deliver-Controls. Die Seite lädt `access_token` + `sent_at` jetzt auch für `sent` (broadened auf `isGenerated || isSent`).

i18n `deliver.*` ([lib/i18n/de.ts](lib/i18n/de.ts)). **KEIN Belohnungs-Bezug** (wie §8.6 für Reviews).

---

## QR-Druckansicht — Handover am Tresen (Schritt 9c-2)

Druckoptimierte, **Bon-Drucker-taugliche** Ansicht (QR + Kundenname + kurzer Hinweis), die den **No-E-Mail-Auslieferungspfad** schließt: scannen statt mailen. Der QR kodiert den **Kunden-Booklet-Link** (`?c=1`). **Keine Migration.** Damit ist der manuelle Auslieferungs-Pfad (9c) vollständig; **View-/Share-Analytics** (`booklet_events`) + Stufen `viewed`/`shared` bleiben offen.

### Setup

Dependencies `qrcode` + `@types/qrcode` (pnpm; reines JS-Paket, **kein** Lifecycle-Script → **nicht** in `pnpm.onlyBuiltDependencies`).

### QR-Druckseite ([app/portal/orders/[id]/qr/page.tsx](app/portal/orders/[id]/qr/page.tsx), Server Component, `force-dynamic`)

- **ISOLATION (RLS):** `getCurrentBusiness` (kein Betrieb ⇒ `notFound()`; die Middleware schützt `/portal/*` ohnehin schon vor anonymem Zugriff). Order (`customer_name`, `status`) und Booklet (`access_token`) werden über den **AUTHENTICATED Client** geladen (RLS skopiert auf den Betrieb; fremde/fehlende ⇒ `notFound()`). **Guard:** ein Booklet muss existieren **und** der Auftrag muss `generated` **oder** `sent` sein — sonst `notFound()` (vor der Generierung gibt es keinen Link zum Drucken).
- **Link:** `customerUrl = ${BOOKLET_BASE_URL}/b/${access_token}?${CUSTOMER_VIEW_QUERY}` — derselbe **`?c=1`**-Kunden-Link wie die E-Mail (9c-1), `CUSTOMER_VIEW_QUERY` aus [lib/booklet/customer-view.ts](lib/booklet/customer-view.ts) (9d). Basis-URL bevorzugt `BOOKLET_BASE_URL`, sonst Fallback auf den Request-Origin (x-forwarded-host/proto) — **identische Logik** zur deliver-Route.
- **QR SERVER-SEITIG** via `QRCode.toString(customerUrl, { type:'svg', errorCorrectionLevel:'M', margin:1, width:256, color:{ dark:'#000', light:'#fff' } })` → das SVG wird per `dangerouslySetInnerHTML` eingebettet (scharf dank viewBox + `shape-rendering:crispEdges`, **kein** Client-JS für den Code nötig; `errorCorrectionLevel 'M'` robust gegen leichte Druck-/Scan-Fehler). Server-generiert + nicht nutzergesteuert ⇒ XSS-unkritisch.
- **Druck-Karte** (schmal + S/W, `.qr-card` in [app/globals.css](app/globals.css)): Betriebsname, „Für {customer_name}", der QR (CSS-fix 240px, das SVG füllt den Container), kurzer Hinweis. **Kein Logo** (Thermodruck ist S/W — kein Verlass auf Farbe/Logo; der Betriebsname als Text ist der verlässliche Identifier).

### Druck-Verhalten

- Kleiner Client-Button „Drucken" ([qr-print-button.tsx](app/portal/orders/[id]/qr/qr-print-button.tsx), `window.print()`) — die einzige Client-Komponente, damit die Seite Server Component bleibt.
- **`@media print`** ([app/globals.css](app/globals.css)): Portal-Chrome (`.portal-sidebar`, `.portal-topbar`, `.portal-tabnav`) **und** der Druck-Button (`.qr-no-print`) werden `display:none`; `.portal-main`-Padding auf 0, die Karte randlos/zentriert → **nur** die QR-Karte druckt.

### Zugang ([app/portal/orders/[id]/page.tsx](app/portal/orders/[id]/page.tsx))

Link „QR drucken" (`btn-outline`, neuer Tab) auf der Detailseite, sobald ein Booklet existiert (`(isGenerated || isSent) && bookletToken`) → öffnet `/portal/orders/[id]/qr`.

i18n `qr.*` ([lib/i18n/de.ts](lib/i18n/de.ts)): `printButton`, `forCustomer` (`{name}`), `hint`. Keine Inline-Strings.

---

## Analytics Write-Pfad — booklet_events + Lifecycle viewed/shared (Schritt 10a)

Erfasst Booklet-Interaktionen in `booklet_events` und rückt den Auftragsstatus monoton vorwärts (`sent → viewed → shared`). **Keine Migration** (Tabelle `booklet_events` + Spalten `event_type`/`channel`/`ip_hash` aus 0001, Status-Enum aus 0001). Das **Dashboard** (Aggregation/Anzeige der Events) folgt in 10b und bleibt offen.

### Event-Taxonomie (`event_type` / `channel`)

`event_type` bleibt im 0001-erlaubten Wertebereich (`viewed`/`shared`/`qr_click`/`link_click`); genutzt werden `viewed`/`shared`/`link_click`, die feinere Spezifik trägt der `channel`:

| `event_type` | `channel` | Auslöser |
| --- | --- | --- |
| `viewed` | — (null) | Seite geöffnet (alle Öffner) |
| `shared` | `reel` | Reel teilen/Download |
| `shared` | `story` | Story teilen |
| `shared` | `whatsapp` | WhatsApp |
| `shared` | `copy` | Link kopieren |
| `link_click` | `website` | Outro-Website-Klick |
| `link_click` | `review` | Google-Review-Klick |
| `link_click` | `ig` | IG-Caption kopiert |

Geteilte, **plain** (secret-freie, client-importierbare) Quelle: [lib/booklet/events.ts](lib/booklet/events.ts) — `EVENT_TYPES`/`EVENT_CHANNELS` (typsichere Literale) + `parseBookletEvent(eventType, channel)`. Letzteres prüft Typ **und** die erlaubte (event_type → channel)-Kombination gegen eine feste Whitelist (`null`-channel nur für `viewed`); ungültig ⇒ `null` (Endpoint → 400). Der Client nutzt nur die Typliterale (`import type`), die Validierung läuft server-seitig.

### Öffentlicher Event-Endpoint ([app/api/b/[token]/event/route.ts](app/api/b/[token]/event/route.ts), `POST`)

- **SICHERHEIT (§14.2):** ausschließlich **`service_role`**. Der **Token** aus dem URL-Pfad ist die **EINZIGE** vertrauenswürdige Quelle: `token → booklets-Row → business_id`/`order_id` — **nie** ein Client-Wert. Ungültiger Token ⇒ **404**, **kein** Write.
- **Body** `{ event_type, channel? }` → `parseBookletEvent`; unerlaubte Kombi ⇒ **400**, **kein** Write. Defektes JSON ⇒ 400.
- **`ip_hash`:** die Request-IP (`x-forwarded-for` erster Eintrag, sonst `x-real-ip`) wird **server-seitig gesalzen-gehasht** (`sha256("{IP_HASH_SALT}:{ip}")`, `node:crypto`) — **nie roh** gespeichert; ohne IP ⇒ `null`. Salt aus `IP_HASH_SALT` (server-only; fehlend ⇒ leerer Salt, Hash bleibt deterministisch).
- **Insert** (`service_role` — `booklet_events` hat **kein** `authenticated`-INSERT-Grant): `{ booklet_id, business_id, event_type, channel, ip_hash }`, `business_id`/`booklet_id` aus der Booklet-Row.
- **Lifecycle-Vorrücken** (monoton vorwärts, defensiv gefiltert — nie zurück, nie überspringen):
  - `viewed` → `orders.status 'sent' → 'viewed'` (nur wenn aktuell `sent`, `.eq('status','sent')`); `booklets.viewed_at` setzen falls `null`.
  - `shared` → `orders.status ∈ {'sent','viewed'} → 'shared'` (`.in('status',['sent','viewed'])`); `booklets.first_shared_at` setzen falls `null`.
  - `link_click` rückt den Status **nicht** vor.
- **Fire-and-forget:** der Endpoint antwortet schnell (`{ ok:true }`); nicht-kritische Insert-/Update-Fehler werden nur geloggt (Kontext `order_id`/`step`/`message`), brechen aber nicht ab.

### Client feuert Events (fire-and-forget)

- Geteilter Helfer [lib/booklet/track.ts](lib/booklet/track.ts): `trackBookletEvent(token, eventType, channel?)` — POST an `/api/b/[token]/event`, **nicht awaitable**, schluckt jeden Fehler (Analytics darf die UI nie stören), `keepalive:true` (überlebt Navigation: Share-Sheet/WhatsApp/neuer Tab). Der **Token kommt aus dem URL-Pfad** (die Seite kennt ihn), **kein** `business_id` im Client.
- **Seitenaufruf** ([view-tracker.tsx](app/b/[token]/view-tracker.tsx), Client, rendert nichts): feuert beim Mount **einmalig** `viewed` (Guard via `useRef` gegen StrictMode-Doppel-Mount). Mountet in der Story-Wurzel — gilt für **ALLE** Öffner (Kunde UND Empfänger), unabhängig von `?c=1` (Reichweite zählt).
- **Teilen** ([share-bar.tsx](app/b/[token]/share-bar.tsx)): „Reel teilen" → `shared/reel`, „Story teilen" → `shared/story`, „WhatsApp" → `shared/whatsapp`, „Link kopieren" → `shared/copy`, IG-Caption kopieren → `link_click/ig`, Google-Bewertung → `link_click/review`. (Der interne Copy-Fallback von „Story teilen" feuert **kein** zweites `copy`-Event — `story` ist bereits gezählt.)
- **Outro-Website-Klick** ([tracked-link.tsx](app/b/[token]/tracked-link.tsx), Client-`<a>`): `link_click/website` beim Klick (für **alle** Öffner). Das native Navigieren bleibt unverändert.

`IP_HASH_SALT` neu in [.env.example](.env.example) (server-only).

---

> Nächste Migration: **0005**.
