-- 0017_orders_website_text_checks.sql — Verifikation der Website-Text-Spalte.
-- Im SQL-Editor des Handwerk-Projekts ausführen NACHDEM die Migration angewendet wurde.

-- 1) Spalte vorhanden, mit erwartetem Typ / Nullability / Default?
--    erwartet:
--      website_text  text | YES | (null)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'website_text';

-- 2) Gegenprobe: KEIN CHECK auf website_text (bewusst — die 80-Zeichen-Pflicht
--    gilt nur bei website_visible = true und liegt deshalb im Route Handler,
--    genau wie bei website_work_hours/website_price aus 0015).
--    (erwartet: 0 Zeilen)
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'orders' and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%website_text%';

-- 3) Bestehende Zeilen: alle NULL, niemand ist ungefragt betroffen.
--    (erwartet: mit_text = 0)
select
  count(*) as zeilen_gesamt,
  count(website_text) as mit_text,
  count(*) filter (where website_visible) as sichtbar
from public.orders;

-- 4) ⚠️ Konsistenz-Prüfung für den Bestand: Gibt es sichtbare Aufträge OHNE
--    ausreichenden Text? Solche Zeilen sind vor 0017 entstanden und lassen
--    sich über die Oberfläche nicht mehr abschalten (Einbahn-Sperre aus 0015).
--    Sie müssen von Hand nachgetextet werden, sonst schiebt die Website ihre
--    Übernahme dauerhaft auf.
--    (erwartet direkt nach der Migration: alle bisher sichtbaren Aufträge)
select id, external_ref, customer_name,
       coalesce(length(btrim(website_text)), 0) as text_laenge
from public.orders
where website_visible
  and coalesce(length(btrim(website_text)), 0) < 80
order by created_at;

-- 5) Kommentar gesetzt?
select col_description('public.orders'::regclass, ordinal_position) as comment
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name = 'website_text';
