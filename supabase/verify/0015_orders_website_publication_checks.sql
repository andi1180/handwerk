-- 0015_orders_website_publication_checks.sql — Verifikation der Website-Spalten.
-- Im SQL-Editor des Handwerk-Projekts ausführen NACHDEM die Migration angewendet wurde.

-- 1) Alle fünf Spalten vorhanden, mit erwartetem Typ / Nullability / Default?
--    erwartet:
--      website_visible       boolean | NO  | false
--      website_category      text    | YES | 'aenderung'::text
--      website_clothing_type text    | YES | (null)
--      website_work_hours    numeric | YES | (null)
--      website_price         numeric | YES | (null)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name in (
    'website_visible',
    'website_category',
    'website_clothing_type',
    'website_work_hours',
    'website_price'
  )
order by column_name;

-- 2) CHECK-Constraint auf website_category vorhanden + genau die 3 Werte?
--    (erwartet: EINE Zeile mit aenderung/redesign/upcycling)
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'orders' and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%website_category%';

-- 3) Gegenprobe: KEIN CHECK auf website_clothing_type (bewusst — das
--    Website-Enum wächst; die Validierung liegt in lib/orders/website.ts).
--    (erwartet: 0 Zeilen)
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'orders' and con.contype = 'c'
  and pg_get_constraintdef(con.oid) ilike '%website_clothing_type%';

-- 4) Bestandsschutz: KEIN bestehender Auftrag steht ungefragt auf der Website.
--    (erwartet: sichtbar = 0; gesamt = die tatsächliche Auftragszahl)
select
  count(*) filter (where website_visible) as sichtbar,
  count(*)                                as gesamt
from public.orders;

-- 5) Spaltenkommentare gesetzt? (erwartet: fünf Zeilen mit Text, keine null)
select column_name,
       col_description('public.orders'::regclass, ordinal_position) as comment
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
  and column_name in (
    'website_visible',
    'website_category',
    'website_clothing_type',
    'website_work_hours',
    'website_price'
  )
order by column_name;
