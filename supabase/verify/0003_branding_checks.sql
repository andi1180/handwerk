-- 0003_branding_checks.sql — Verifikation des Branding-Fundaments. Im SQL-Editor des Handwerk-Projekts ausführen.
-- 1) Bucket existiert + ist privat? (erwartet: branding, public = false)
select id, public from storage.buckets where id = 'branding';

-- 2) Genau 4 branding_*-Policies, alle nur für authenticated?
--    (erwartet: branding_select/_insert/_update/_delete, roles = {authenticated})
--    Bevorzugt über die eingebaute Katalog-View pg_policies (in Supabase verfügbar):
select policyname, roles::text
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'branding_%'
order by policyname;

-- Fallback (falls pg_policies nicht verfügbar): direkt über die Systemkataloge:
select polname, (select array_agg(rolname) from pg_roles where oid = any(polroles)) as roles
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'storage' and c.relname = 'objects' and polname like 'branding_%'
order by polname;

-- 3) Keine anon-Policy auf dem branding-Bucket? (erwartet: 0 Zeilen)
select policyname, roles::text
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'branding_%'
  and 'anon' = any(roles);
