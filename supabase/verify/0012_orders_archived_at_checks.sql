-- 0012_orders_archived_at_checks.sql — Verifikation der Archiv-Spalte.
-- Im SQL-Editor des Handwerk-Projekts ausführen NACHDEM die Migration angewendet wurde.

-- 1) Spalte existiert mit dem erwarteten Typ und ist nullable?
--    (erwartet: data_type = 'timestamp with time zone', is_nullable = 'YES')
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'archived_at';
