-- 0005_pending_status_checks.sql — Verifikation des erweiterten Status-Constraints.
-- Im SQL-Editor des Handwerk-Projekts ausführen.

-- 1) Der CHECK-Constraint auf businesses.status erlaubt jetzt pending/active/suspended?
--    (erwartet: eine CHECK-Definition, die alle drei Werte nennt)
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'businesses' and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%status%';

-- 2) Default ist weiterhin 'active' (nur neue Registrierungen starten auf 'pending')?
select column_name, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'businesses'
  and column_name = 'status';
