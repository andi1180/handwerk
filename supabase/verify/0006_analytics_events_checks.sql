-- 0006_analytics_events_checks.sql — Verifikation des Analytics-Event-Fundaments.
-- Im SQL-Editor des Handwerk-Projekts ausführen.

-- 1) Tabelle + erwartete Spalten/Typen vorhanden?
--    (erwartet: business_id/event_type/source NOT NULL, payload jsonb NOT NULL default '{}', external_ref nullable)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'analytics_events'
order by ordinal_position;

-- 2) RLS aktiviert?  (erwartet: relrowsecurity = true)
select relname, relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'analytics_events';

-- 3) Genau EINE Policy, und zwar SELECT für authenticated?
--    (erwartet: analytics_events_select, cmd = SELECT, roles = {authenticated})
select polname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'analytics_events';

-- 4) Grants: NUR SELECT für authenticated, KEIN insert/update/delete; KEIN anon-Grant.
--    (erwartet: authenticated → SELECT; service_role → alle; anon kommt NICHT vor)
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'analytics_events'
order by grantee, privilege_type;

-- 5) Indizes vorhanden (business_id, created_at) und (business_id, event_type)?
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'analytics_events'
order by indexname;
