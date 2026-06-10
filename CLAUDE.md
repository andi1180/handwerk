# Valooro Handwerk

Eigenständiges Repo mit **eigenem Supabase-Projekt** (getrennt vom Hotel-Projekt). Migrationen starten frisch ab `0001` und werden **manuell** über das Supabase-Dashboard (SQL Editor) angewendet — nie lokal ausführen, nie `supabase db reset`.

Technische Doku: siehe [TECH.md](TECH.md).

## Build-History

- **Schritt 1 ✅ DB-Fundament (Migration 0001)** — 7 Tabellen, RLS, explizite GRANTs, Mandanten-Isolation, i18n-Felder, Verify-Gate.
- **Schritt 2a ✅ App-Scaffold + Supabase-Clients + i18n + CSS-Tokens** — Next.js 15 (App Router, React 19, TS strict), 3 Supabase-Clients (Browser/Server via `@supabase/ssr`, `service_role` via `@supabase/supabase-js`), typsicherer i18n-Layer (`de`), Valooro-Token-System in `globals.css`. Noch ohne Auth/Features.
- **Schritt 2b ✅ Auth + geteilter Login + geschützte Portal-Shell** — `@supabase/ssr` auf `0.12.x`, Middleware-Session-Refresh + Schutz von `/portal/*`, Login-Seite (Client, `signInWithPassword`), `getCurrentBusiness()` über authentifizierten Server-Client (RLS-erzwungen, kein `service_role`), Portal-Shell mit Sidebar + Logout, Test-Seed. Noch ohne Module/Features.
