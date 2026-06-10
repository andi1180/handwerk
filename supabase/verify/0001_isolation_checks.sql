-- Verifikations-Gate — im SQL-Editor des Handwerk-Projekts ausführen. Vor jedem Pilot wiederholen.
-- 1) RLS auf allen Tenant-Tabellen aktiv? (erwartet: alle relrowsecurity = true)
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('businesses','business_users','orders','order_media','booklets','billing_events','booklet_events')
order by relname;
-- 2) Keine Grants für anon? (erwartet: 0 Zeilen)
select table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';
-- 3) SECURITY-DEFINER-Funktionen ohne REVOKE FROM PUBLIC? (erwartet: jetzt 0 Zeilen)
select p.proname, p.prosecdef from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef = true;
-- 4) Laufzeit-Isolation: als Betrieb A (JWT) Zeilen von Betrieb B abrufen -> erwartet 0.
--    Manuell mit zwei Test-Betrieben + zwei Auth-Usern (siehe TECH.md).
