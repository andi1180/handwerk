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

> Nächste Migration: **0003**.
