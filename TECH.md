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

> Nächste Migration: **0002**.
