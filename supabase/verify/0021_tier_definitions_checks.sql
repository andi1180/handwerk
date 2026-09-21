-- Verify-Gate 0021 - manuell im SQL-Editor NACH der Migration ausfuehren.

-- 1) Tabelle + Constraint vorhanden
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'tier_definitions'::regclass;

-- 2) RLS aktiv
select relrowsecurity from pg_class where relname = 'tier_definitions';
-- Erwartung: true

-- 3) authenticated darf NUR select (erwartet: genau eine Zeile, SELECT)
select privilege_type
from information_schema.role_table_grants
where table_name = 'tier_definitions' and grantee = 'authenticated';

-- 4) anon darf gar nichts (erwartet: 0 Zeilen)
select privilege_type
from information_schema.role_table_grants
where table_name = 'tier_definitions' and grantee = 'anon';

-- 5) service_role darf alles
select privilege_type
from information_schema.role_table_grants
where table_name = 'tier_definitions' and grantee = 'service_role'
order by privilege_type;

-- 6) Platzhalter-Daten vorhanden
select tier, limits, features from tier_definitions order by tier;
-- Erwartung: drei Zeilen, WOM Plus/Pro/Starter, jeweils limits={} features={}
