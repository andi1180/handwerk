-- 0008_booklet_short_code.sql — Valooro Handwerk: kurzer öffentlicher Code für /s/<code>.
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts. NICHT lokal ausführen.
--
-- Zweck (Block C): Statt des langen kryptischen Booklet-Links (/b/<24-Byte-Token>?c=1) ein
-- kurzer, teilbarer Link https://handwerk.valooro.com/s/<code>, der serverseitig auf das
-- echte Booklet weiterleitet. `short_code` ist der kurze, URL-sichere Code (app-generiert,
-- ~7 Zeichen, kollisions-sicher per UNIQUE + Retry bei der Generierung).
--
-- Nullable: bestehende Booklets (vor dieser Migration) haben keinen Code — der zu teilende
-- Link fällt für sie auf den langen /b/<token>-Link zurück (KEIN Massen-Backfill nötig).
-- Neue Booklets bekommen bei der Generierung einen Code.
--
-- Das UNIQUE erzeugt zugleich den B-Tree-Index, den der Redirect-Lookup (where short_code = $1)
-- braucht — KEIN separater Index nötig. Mehrere NULLs sind in einem UNIQUE-Constraint erlaubt
-- (NULLs gelten als verschieden), Booklets ohne Code kollidieren also nie.
--
-- KEINE neue Policy/GRANT nötig: booklets ist RLS-aktiv (0001) — die member-Policies
-- (select/update) und `service_role` (grant all) decken die neue Spalte automatisch ab.
-- Der Redirect-Lookup (/s/<code>) läuft serverseitig über service_role (öffentlich, kein
-- User-Kontext — wie der /b/[token]-Read).

alter table public.booklets
  add column short_code text unique;

comment on column public.booklets.short_code is
  'Kurzer öffentlicher Code (app-generiert, ~7 Zeichen, URL-sicher) für den Kurzlink /s/<code> → Redirect aufs Booklet. Nullable: alte Booklets fallen auf den langen /b/<token>-Link zurück.';
