-- 0002_storage_checks.sql — Verifikation des Storage-Fundaments. Im SQL-Editor des Handwerk-Projekts ausführen.
-- 1) Bucket existiert + ist privat? (erwartet: order-media, public = false)
select id, public from storage.buckets where id = 'order-media';

-- 2) Storage-Policies nur für authenticated? (erwartet: 3 Policies order_media_*, roles = {authenticated})
--    Bevorzugt über die eingebaute Katalog-View pg_policies (in Supabase verfügbar):
select policyname, roles::text
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'order_media_%'
order by policyname;

-- Fallback (falls pg_policies nicht verfügbar): direkt über die Systemkataloge:
select polname, (select array_agg(rolname) from pg_roles where oid = any(polroles)) as roles
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'storage' and c.relname = 'objects' and polname like 'order_media_%'
order by polname;
