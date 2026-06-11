-- 0004_reel_status_checks.sql — Verifikation des Reel-Status-Felds. Im SQL-Editor des Handwerk-Projekts ausführen.

-- 1) Beide Spalten existieren mit den erwarteten Typen/Defaults?
--    (erwartet: reel_status text NOT NULL default 'pending', reel_error text NULLABLE)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'booklets'
  and column_name in ('reel_status', 'reel_error')
order by column_name;

-- 2) Check-Constraint auf reel_status vorhanden + erlaubt genau die 4 Werte?
--    (erwartet: eine CHECK-Definition mit pending/rendering/ready/failed)
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'booklets' and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%reel_status%';
