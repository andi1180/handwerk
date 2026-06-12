-- 0009_order_pickup_pending_checks.sql — Verifikation des Pickup-Pending-Flags.
-- Im SQL-Editor des Handwerk-Projekts ausführen.

-- 1) Spalte orders.picked_up_at vorhanden, Typ timestamptz, nullable, Default null?
--    (erwartet: data_type = timestamp with time zone, is_nullable = YES, column_default = NULL)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'picked_up_at';

-- 2) Spaltenkommentar gesetzt?  (erwartet: der Warn-Badge-Hinweis)
select col_description('public.orders'::regclass, ordinal_position) as comment
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'picked_up_at';
