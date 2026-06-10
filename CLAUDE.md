# Valooro Handwerk

Eigenständiges Repo mit **eigenem Supabase-Projekt** (getrennt vom Hotel-Projekt). Migrationen starten frisch ab `0001` und werden **manuell** über das Supabase-Dashboard (SQL Editor) angewendet — nie lokal ausführen, nie `supabase db reset`.

Technische Doku: siehe [TECH.md](TECH.md).

## Build-History

- **Schritt 1 ✅ DB-Fundament (Migration 0001)** — 7 Tabellen, RLS, explizite GRANTs, Mandanten-Isolation, i18n-Felder, Verify-Gate.
