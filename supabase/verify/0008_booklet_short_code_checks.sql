-- 0008_booklet_short_code_checks.sql — Verifikation des Booklet-Kurzcodes.
-- Im SQL-Editor des Handwerk-Projekts ausführen.

-- 1) Spalte booklets.short_code vorhanden, Typ text, nullable?
--    (erwartet: data_type = text, is_nullable = YES)
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'booklets'
  and column_name = 'short_code';

-- 2) UNIQUE-Constraint (= zugleich der B-Tree-Index für den Redirect-Lookup) auf short_code?
--    (erwartet: genau eine Zeile, indexdef enthält UNIQUE und short_code)
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'booklets'
  and indexdef ilike '%short_code%';

-- 3) Spaltenkommentar gesetzt?  (erwartet: der Kurzlink-Hinweis)
select col_description('public.booklets'::regclass, ordinal_position) as comment
from information_schema.columns
where table_schema = 'public' and table_name = 'booklets'
  and column_name = 'short_code';
