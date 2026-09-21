-- Verify-Gate 0023 - manuell im SQL-Editor NACH der Migration
-- ausfuehren. SQL-Editor laeuft mit erhoehten Rechten (RLS greift dort
-- nicht), die Ergebnisse zeigen also den vollen Datenbestand, nicht
-- das, was ein eingeloggter Nutzer sehen wuerde - genau das macht die
-- Grant-Pruefung unten aussagekraeftig.

-- 1) Tabelle + FK vorhanden
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'platform_admins'::regclass;

-- 2) RLS aktiv (Erwartung: true)
select relrowsecurity from pg_class where relname = 'platform_admins';

-- 3) authenticated darf NUR select (erwartet: genau eine Zeile, SELECT)
select privilege_type
from information_schema.role_table_grants
where table_name = 'platform_admins' and grantee = 'authenticated';

-- 4) anon darf gar nichts (erwartet: 0 Zeilen)
select privilege_type
from information_schema.role_table_grants
where table_name = 'platform_admins' and grantee = 'anon';

-- 5) service_role darf alles (erwartet: mehrere Zeilen)
select privilege_type
from information_schema.role_table_grants
where table_name = 'platform_admins' and grantee = 'service_role'
order by privilege_type;

-- 6) Backfill-Status
select pa.user_id, u.email, pa.created_at
from platform_admins pa
join auth.users u on u.id = pa.user_id;
-- Erwartung: eine Zeile, andreas.dax@gmail.com (diese Adresse ist
--   bereits als Owner des Test-Betriebs eingeloggt gewesen, die
--   auth.users-Zeile sollte also existieren und der Backfill greifen).
-- 0 Zeilen waere ebenfalls kein Fehler dieser Migration, nur ein
--   Hinweis, dass die Annahme oben nicht stimmt - dann Backfill
--   manuell nachholen (Statement im NOTICE der Migration).
