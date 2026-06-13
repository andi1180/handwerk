-- 0010_media_category_checks.sql — Verifikation der Bild-Kategorie. Im SQL-Editor des Handwerk-Projekts ausführen.

-- 1) Spalte order_media.category vorhanden, Typ text, NOT NULL, Default 'process'?
--    (erwartet: data_type = text, is_nullable = NO, column_default = 'process'::text)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'order_media'
  and column_name = 'category';

-- 2) Check-Constraint auf category vorhanden + erlaubt genau die 3 Werte?
--    (erwartet: eine CHECK-Definition mit before/after/process)
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'order_media' and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%category%';

-- 3) Spaltenkommentar gesetzt?  (erwartet: der Bild-Kategorie-Hinweis)
select col_description('public.order_media'::regclass, ordinal_position) as comment
from information_schema.columns
where table_schema = 'public' and table_name = 'order_media'
  and column_name = 'category';
