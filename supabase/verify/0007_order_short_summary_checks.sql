-- 0007_order_short_summary_checks.sql — Verifikation der Auftrags-Kurzbeschreibung.
-- Im SQL-Editor des Handwerk-Projekts ausführen.

-- 1) Spalte orders.short_summary vorhanden, Typ text, nullable, Default null?
--    (erwartet: data_type = text, is_nullable = YES, column_default = NULL)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'short_summary';

-- 2) Spaltenkommentar gesetzt?  (erwartet: der KI-Kurzbeschreibungs-Hinweis)
select col_description('public.orders'::regclass, ordinal_position) as comment
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'short_summary';
