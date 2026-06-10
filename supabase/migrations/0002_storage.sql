-- 0002_storage.sql — Valooro Handwerk: Storage-Bucket order-media + tenant-skopierte Policies
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts.

insert into storage.buckets (id, name, public)
values ('order-media', 'order-media', false)
on conflict (id) do nothing;

-- Zugriff nur für Betriebs-Mitglieder; erstes Pfad-Segment = business_id
create policy "order_media_select" on storage.objects for select to authenticated
using (
  bucket_id = 'order-media'
  and exists (select 1 from public.business_users bu
              where bu.user_id = auth.uid()
                and bu.business_id::text = (storage.foldername(name))[1])
);
create policy "order_media_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'order-media'
  and exists (select 1 from public.business_users bu
              where bu.user_id = auth.uid()
                and bu.business_id::text = (storage.foldername(name))[1])
);
create policy "order_media_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'order-media'
  and exists (select 1 from public.business_users bu
              where bu.user_id = auth.uid()
                and bu.business_id::text = (storage.foldername(name))[1])
);
-- service_role umgeht RLS (für spätere server-seitige Generierung) — keine Policy nötig.
-- anon: keine Policy = kein Zugriff.
