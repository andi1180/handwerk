-- Verify-Gate 0022 - manuell im SQL-Editor NACH der Migration ausfuehren.

-- 1) authenticated darf NUR SELECT (erwartet: genau eine Zeile, SELECT)
select privilege_type
from information_schema.role_table_grants
where table_name = 'tier_definitions' and grantee = 'authenticated';

-- 2) service_role weiterhin uneingeschraenkt (erwartet: mehrere Zeilen)
select privilege_type
from information_schema.role_table_grants
where table_name = 'tier_definitions' and grantee = 'service_role'
order by privilege_type;

-- 3) anon weiterhin nichts (erwartet: 0 Zeilen, unveraendert seit 0021)
select privilege_type
from information_schema.role_table_grants
where table_name = 'tier_definitions' and grantee = 'anon';

-- 4) Gegenprobe: lesen geht fuer authenticated weiterhin (erwartet: 3 Zeilen)
select tier, limits, features from tier_definitions order by tier;
