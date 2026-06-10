# Valooro Handwerk

Eigenständiges Repo mit **eigenem Supabase-Projekt** (getrennt vom Hotel-Projekt). Migrationen starten frisch ab `0001` und werden **manuell** über das Supabase-Dashboard (SQL Editor) angewendet — nie lokal ausführen, nie `supabase db reset`.

Technische Doku: siehe [TECH.md](TECH.md).

## Build-History

- **Schritt 1 ✅ DB-Fundament (Migration 0001)** — 7 Tabellen, RLS, explizite GRANTs, Mandanten-Isolation, i18n-Felder, Verify-Gate.
- **Schritt 2a ✅ App-Scaffold + Supabase-Clients + i18n + CSS-Tokens** — Next.js 15 (App Router, React 19, TS strict), 3 Supabase-Clients (Browser/Server via `@supabase/ssr`, `service_role` via `@supabase/supabase-js`), typsicherer i18n-Layer (`de`), Valooro-Token-System in `globals.css`. Noch ohne Auth/Features.
- **Schritt 2b ✅ Auth + geteilter Login + geschützte Portal-Shell** — `@supabase/ssr` auf `0.12.x`, Middleware-Session-Refresh + Schutz von `/portal/*`, Login-Seite (Client, `signInWithPassword`), `getCurrentBusiness()` über authentifizierten Server-Client (RLS-erzwungen, kein `service_role`), Portal-Shell mit Sidebar + Logout, Test-Seed. Noch ohne Module/Features.
- **Schritt 3 ✅ Auftrag anlegen + Auftragsliste (manueller Pfad)** — Sidebar-Nav (Client, Aktiv-Zustand via `usePathname`) um „Aufträge" erweitert; Auftragsliste (Server Component, AUTHENTICATED Client, RLS + defensiver `business_id`-Filter, `created_at DESC`); Status-Badge-Komponente; Anlage-Formular (Client, `div + onClick`, kein `<form>`); Route Handler `POST /api/portal/orders` mit `business_id` aus Session (Isolationsregel), `status='draft'`. Mobile-first. Kein Capture/Media, keine Generierung.
- **Schritt 4a ✅ Storage-Fundament (0002) + Auftrags-Detailseite + Medien-Liste** — Bucket `order-media` (privat) + tenant-skopierte `storage.objects`-Policies (erstes Pfad-Segment = `business_id`), Verify-Gate `0002`; klickbare Auftragsliste; Detailseite (Server Component, mobile-first) mit stickyem Kopf (Kundenname + Status-Badge), Stammdaten und Medien-Liste (RLS, `sort_order` ASC, Thumbnails via server-seitiger Signed-URLs aus privatem Bucket); Query-Helper `getOrderById`/`getOrderMedia`. Reine Anzeige — kein Capture/Upload (4b), keine Generierung.
