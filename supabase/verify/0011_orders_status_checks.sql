-- 0011_orders_status_checks.sql — Verifikation der vereinfachten Status-Maschine.
-- Im SQL-Editor des Handwerk-Projekts ausführen.

-- 1) Der CHECK-Constraint auf orders.status erlaubt jetzt GENAU
--    draft/generated/sent/viewed/shared — OHNE 'finalized'?
--    (erwartet: eine CHECK-Definition, die diese fünf Werte nennt und KEIN 'finalized')
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'orders' and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%status%';

-- 2) Default ist weiterhin 'draft'?
select column_name, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'status';

-- 3) Keine Zeile mehr im entfallenen Status 'finalized' (erwartet: 0).
select count(*) as finalized_rows
from public.orders
where status = 'finalized';
