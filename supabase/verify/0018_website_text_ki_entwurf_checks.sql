-- 0018_website_text_ki_entwurf_checks.sql — Verifikation des KI-Entwurf-Kennzeichens.
-- Im SQL-Editor des Handwerk-Projekts ausführen NACHDEM die Migration angewendet wurde.

-- 1) Spalte vorhanden, mit erwartetem Typ / Nullability / Default?
--    erwartet:
--      website_text_ki_entwurf  boolean | NO | false
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'website_text_ki_entwurf';

-- 2) Bestehende Zeilen: alle false. Kein heute vorhandener Text stammt von der
--    KI — es gab bis zu dieser Migration gar keine Erzeugung.
--    (erwartet: als_ki_entwurf = 0)
select
  count(*) as zeilen_gesamt,
  count(*) filter (where website_text_ki_entwurf) as als_ki_entwurf,
  count(website_text) as mit_text
from public.orders;

-- 3) Gegenprobe auf Widersprüche: ein Kennzeichen ohne Text darf es nicht
--    geben. Der Route Handler setzt das Kennzeichen nur zusammen mit einem
--    Text; eine Zeile hier wäre ein Hinweis auf einen Eingriff von Hand.
--    (erwartet: 0 Zeilen)
select id, external_ref, website_visible
from public.orders
where website_text_ki_entwurf
  and coalesce(length(btrim(website_text)), 0) = 0;

-- 4) Betriebsblick: welche sichtbaren Aufträge tragen einen ungeprüften
--    KI-Entwurf? Genau die muss drüben noch jemand ansehen.
--    (direkt nach der Migration erwartet: 0 Zeilen)
select id, external_ref, customer_name,
       length(btrim(website_text)) as text_laenge
from public.orders
where website_visible and website_text_ki_entwurf
order by updated_at desc;

-- 5) Kommentar gesetzt?
select col_description('public.orders'::regclass, ordinal_position) as comment
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'website_text_ki_entwurf';
