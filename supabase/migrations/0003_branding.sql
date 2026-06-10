-- 0003_branding.sql — Valooro Handwerk: Storage-Bucket branding (Logo) + tenant-skopierte Policies
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts.
--
-- WARUM PRIVAT + SIGNED-URL (nicht public-read):
--   Architektur-Konsistenz mit order-media — EIN Zugriffsmodell, EINE Isolations-Grenze
--   (erstes Pfad-Segment = business_id). Das öffentliche Booklet /b/[token] rendert
--   server-seitig über service_role und signiert das Logo bei JEDEM Request frisch —
--   der Ablauf der Signed-URL ist damit irrelevant. Public-read würde einen zweiten
--   Bucket-Typ einführen, den man bei jeder Isolations-Frage mitdenken müsste; der
--   Logo-Wert (öffentliche Bildmarke) rechtfertigt diese Sonderbehandlung nicht.

insert into storage.buckets (id, name, public)
values ('branding', 'branding', false)
on conflict (id) do nothing;

-- Zugriff nur für Betriebs-Mitglieder; erstes Pfad-Segment = business_id (Muster wie 0002).
-- service_role umgeht RLS (für server-seitiges Booklet-Rendering) — keine Policy nötig.
-- anon: keine Policy = kein Zugriff. KEIN PUBLIC-Grant.
create policy "branding_select" on storage.objects for select to authenticated
using (
  bucket_id = 'branding'
  and exists (select 1 from public.business_users bu
              where bu.user_id = auth.uid()
                and bu.business_id::text = (storage.foldername(name))[1])
);
create policy "branding_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'branding'
  and exists (select 1 from public.business_users bu
              where bu.user_id = auth.uid()
                and bu.business_id::text = (storage.foldername(name))[1])
);
-- UPDATE-Policy nötig, weil der Logo-Upload mit upsert=true ein vorhandenes Objekt überschreibt.
create policy "branding_update" on storage.objects for update to authenticated
using (
  bucket_id = 'branding'
  and exists (select 1 from public.business_users bu
              where bu.user_id = auth.uid()
                and bu.business_id::text = (storage.foldername(name))[1])
)
with check (
  bucket_id = 'branding'
  and exists (select 1 from public.business_users bu
              where bu.user_id = auth.uid()
                and bu.business_id::text = (storage.foldername(name))[1])
);
create policy "branding_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'branding'
  and exists (select 1 from public.business_users bu
              where bu.user_id = auth.uid()
                and bu.business_id::text = (storage.foldername(name))[1])
);
