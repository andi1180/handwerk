-- 0014_booklets_reel_status_purged_checks.sql — Verifikation des 'purged'-Status.
-- Im SQL-Editor des Handwerk-Projekts NACH 0014 ausführen.

-- 1) Beide CHECK-Constraints vorhanden und um 'purged' erweitert?
--    (erwartet: 2 Zeilen, beide Definitionen enthalten 'purged')
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'booklets' and con.contype = 'c'
  and con.conname in ('booklets_reel_status_check', 'booklets_business_reel_status_check')
order by con.conname;

-- 2) Gegenprobe: existiert nach dem drop/add je Spalte GENAU EIN CHECK?
--    (erwartet: reel_status = 1, business_reel_status = 1 — mehr als 1 hieße, der
--     alte Constraint hatte einen anderen Namen und wurde nicht gedroppt; dann
--     blockiert er weiterhin 'purged'.)
select
  count(*) filter (where pg_get_constraintdef(con.oid) ilike '%reel_status in%'
                     and pg_get_constraintdef(con.oid) not ilike '%business_reel_status%') as reel_status_checks,
  count(*) filter (where pg_get_constraintdef(con.oid) ilike '%business_reel_status in%')  as business_reel_status_checks
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'booklets' and con.contype = 'c';

-- 3) Statusverteilung nach dem Nachlauf-UPDATE.
--    (erwartet: reel_status 'purged' = 15, business_reel_status 'purged' = 14)
select reel_status, count(*) from public.booklets group by reel_status order by reel_status;
select business_reel_status, count(*) from public.booklets group by business_reel_status order by business_reel_status;

-- 4) Die 15 bereinigten Aufträge einzeln — Zeilen müssen ALLE noch existieren.
--    (erwartet: 15 Zeilen; reel_status durchgängig 'purged';
--     business_reel_status 'purged' außer N1422 = 'pending')
select o.external_ref, b.reel_status, b.business_reel_status,
       (select count(*) from public.order_media m where m.order_id = o.id) as media_rows
from public.booklets b
join public.orders o on o.id = b.order_id
where b.order_id in (
  '99f72cbd-0d09-4473-8dbd-1104f3415ac6', 'bfa3785a-9067-42d6-b9ec-344ef83a4817',
  '4115ec71-e32e-4dd3-914c-6962495f78b3', '268830dd-e994-4dd4-9486-91f1d472bc07',
  'd23eec53-2075-4c2c-bab3-b6a7765d0f6c', '23bc6ffe-bccf-4e23-bb99-3f744cdf73fb',
  'b609d8ec-65ec-46b7-812c-e3ecb86f8fd4', '6d4f9193-ee37-4cd2-88cc-bb5c2fba89a4',
  'ff32df0a-c67b-447a-8c09-1dc8abc6c623', '96e0d55a-fc1e-499b-98f3-123bee44bf63',
  'd752ae12-2860-4750-9839-7402f82c3fa4', '0b5da113-9393-4d23-9ff9-894f3217d780',
  '7de4a776-3384-418b-a3f5-15ed144e3288', '2f4152bd-abe5-47d9-ae48-43af83ff6a4b',
  '84def70a-b819-4fcd-b51a-a614138020cc'
)
order by o.external_ref desc;

-- 5) Analytics-Historie unangetastet? media_rows in (4) muss 0 sein, booklet_events > 0.
--    (erwartet: dieselbe Gesamtzahl wie vor der Bereinigung — 88)
select count(*) as booklet_events_total from public.booklet_events;
