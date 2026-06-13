-- delete_test_orders.sql — 4 Test-Aufträge des Betriebs "Atelier Dax" sauber löschen.
--
-- ANWENDUNG: manuell im Supabase-SQL-Editor (Handwerk-Projekt). KEINE Migration
-- (kein Schema-Change). NICHT lokal ausführen.
--
-- KONTEXT: Diese 4 Aufträge wurden auch in roapp gelöscht — es kommen keine
-- weiteren Status-Events mehr rein. Sie sollen vollständig aus DB + Storage raus.
--
--   Betrieb : "Atelier Dax"  →  business_email = 'office@alinadax.com'  (unique)
--   Aufträge: external_ref IN ('N1401','N1400','N1396','N1394')         (= roapp id_label)
--
-- SICHERHEIT: JEDES Statement ist auf business_id (Atelier Dax) UND die 4
-- external_refs gescoped — NIE auf external_ref allein. Damit ist ein
-- versehentliches Löschen fremder Betriebe ausgeschlossen, selbst wenn ein
-- anderer Betrieb zufällig dieselbe Auftragsnummer hätte.
--
-- ============================================================================
-- FK-BEFUND (Migration 0001 + 0006) — was beim Löschen einer orders-Zeile passiert:
--
--   order_media.order_id     → orders   ON DELETE CASCADE   → verschwindet automatisch
--   booklets.order_id        → orders   ON DELETE CASCADE   → verschwindet automatisch
--   booklet_events.booklet_id→ booklets ON DELETE CASCADE   → verschwindet via booklets
--   billing_events.order_id  → orders   ON DELETE SET NULL  → bleibt (order_id genullt) !
--   billing_events.booklet_id→ booklets ON DELETE SET NULL  → bleibt (booklet_id genullt)!
--   analytics_events         → (kein FK auf orders, nur external_ref) → bleibt !
--
-- => Ein blankes "DELETE FROM orders" würde billing_events UND analytics_events
--    als Leichen zurücklassen. Darum unten die EXPLIZITE Kinder-zuerst-Kette.
--    billing_events MUSS vor orders gelöscht werden (danach ist order_id = NULL
--    und nicht mehr auf die Aufträge eingrenzbar).
-- ============================================================================
--
-- REIHENFOLGE FÜRS AUSFÜHREN (jeden BLOCK einzeln markieren + ausführen):
--   1. SCHRITT 1  — Vorschau (zeigt die 4 Aufträge + Anzahl ihrer Anhängsel). PRÜFEN!
--   2. SCHRITT 2  — Storage-Pfade auslesen + irgendwo sichern (VOR dem DB-Delete!).
--   3. SCHRITT 3  — Lösch-Transaktion ausführen.
--   4. SCHRITT 4  — Verifikation (sollte 0 Zeilen liefern).
--   5. Danach die in SCHRITT 2 ausgelesenen Storage-Ordner manuell löschen.


-- ============================================================================
-- SCHRITT 1 — VORSCHAU (NUR LESEN). Diesen Block EINZELN markieren + ausführen.
-- Erwartung: GENAU 4 Zeilen (N1401, N1400, N1396, N1394). Erscheinen weniger,
-- existiert eine der Nummern nicht (schon weg / andere Schreibweise) — dann STOP
-- und Refs prüfen, bevor irgendetwas gelöscht wird.
-- ============================================================================
select
  o.external_ref,
  o.id            as order_id,
  o.customer_name,
  o.status,
  o.created_at,
  (select count(*) from public.order_media m
     where m.order_id = o.id)                                          as media,
  (select count(*) from public.booklets bk
     where bk.order_id = o.id)                                         as booklets,
  (select count(*) from public.booklet_events be
     where be.booklet_id in (select id from public.booklets where order_id = o.id))
                                                                       as booklet_events,
  (select count(*) from public.billing_events bi
     where bi.order_id = o.id)                                         as billing_events,
  (select count(*) from public.analytics_events ae
     where ae.business_id = o.business_id and ae.external_ref = o.external_ref)
                                                                       as analytics_events
from public.orders o
join public.businesses b on b.id = o.business_id
where b.business_email = 'office@alinadax.com'
  and o.external_ref in ('N1401','N1400','N1396','N1394')
order by o.external_ref;


-- ============================================================================
-- SCHRITT 2 — STORAGE-PFADE (NUR LESEN). UNBEDINGT VOR dem DB-Delete ausführen
-- und das Ergebnis sichern — nach dem Delete sind order_media/booklets weg und
-- die Pfade nicht mehr ermittelbar. Storage hängt NICHT an den DB-FKs, die
-- Dateien müssen separat im Storage-Dashboard (oder per service_role) gelöscht
-- werden, sonst bleiben sie als Leichen liegen.
--
-- Alle Dateien liegen im Bucket 'order-media' unter der Konvention
--   {business_id}/{order_id}/...   (Fotos/Videos = order_media.storage_path,
--   das Reel = booklets.reel_url = {business_id}/{order_id}/reel.mp4).
--
-- 2a) ORDNER-PRÄFIXE (empfohlen fürs Dashboard) — ein Ordner je Auftrag, deckt
--     Fotos, Videos, reel.mp4 und etwaige Reste in EINEM Rutsch ab:
select distinct
  'order-media'                                  as bucket,
  o.business_id::text || '/' || o.id::text || '/' as folder_prefix
from public.orders o
join public.businesses b on b.id = o.business_id
where b.business_email = 'office@alinadax.com'
  and o.external_ref in ('N1401','N1400','N1396','N1394')
order by folder_prefix;

-- 2b) EINZELNE DATEIEN zum Gegenprüfen (order_media + Reel zusammengefasst):
select 'order-media' as bucket, m.storage_path as path, 'order_media' as kind
from public.order_media m
join public.orders o     on o.id = m.order_id
join public.businesses b on b.id = o.business_id
where b.business_email = 'office@alinadax.com'
  and o.external_ref in ('N1401','N1400','N1396','N1394')
union all
select 'order-media' as bucket, bk.reel_url as path, 'reel' as kind
from public.booklets bk
join public.orders o     on o.id = bk.order_id
join public.businesses b on b.id = o.business_id
where b.business_email = 'office@alinadax.com'
  and o.external_ref in ('N1401','N1400','N1396','N1394')
  and bk.reel_url is not null
order by kind, path;


-- ============================================================================
-- SCHRITT 3 — LÖSCHEN (Kinder zuerst, dann orders). Als EINE Transaktion.
-- Diesen Block EINZELN markieren + ausführen.
--
-- TROCKENLAUF (optional): unten 'commit;' vorübergehend durch 'rollback;'
-- ersetzen — dann werden die betroffenen Zeilen je DELETE im Editor angezeigt
-- ("Rows: N"), aber NICHTS wird wirklich gelöscht. Stimmen die Zahlen mit
-- SCHRITT 1 überein, auf 'commit;' zurückstellen und scharf ausführen.
-- ============================================================================
begin;

-- 1) analytics_events — KEIN FK auf orders (würde NICHT mitgelöscht).
--    Scope: business_id + external_ref (= roapp id_label). PII-frei lt. 0006.
delete from public.analytics_events
where business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
  and external_ref in ('N1401','N1400','N1396','N1394');

-- 2) billing_events — FK = SET NULL (würde NICHT gelöscht, nur genullt).
--    MUSS vor orders laufen (danach ist order_id = NULL).
--    Scope: business_id + order_id ∈ Ziel-Aufträge.
delete from public.billing_events
where business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
  and order_id in (
    select o.id from public.orders o
    where o.business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
      and o.external_ref in ('N1401','N1400','N1396','N1394')
  );

-- 3) booklet_events — FK = CASCADE (verschwände via booklets); hier EXPLIZIT,
--    damit jede Tabelle sichtbar geräumt wird. Scope: business_id + Booklets der Aufträge.
delete from public.booklet_events
where business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
  and booklet_id in (
    select bk.id from public.booklets bk
    where bk.business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
      and bk.order_id in (
        select o.id from public.orders o
        where o.business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
          and o.external_ref in ('N1401','N1400','N1396','N1394')
      )
  );

-- 4) order_media — FK = CASCADE (verschwände via orders); hier EXPLIZIT.
--    Scope: business_id + order_id ∈ Ziel-Aufträge.
delete from public.order_media
where business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
  and order_id in (
    select o.id from public.orders o
    where o.business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
      and o.external_ref in ('N1401','N1400','N1396','N1394')
  );

-- 5) booklets — FK = CASCADE (verschwände via orders); hier EXPLIZIT.
--    Scope: business_id + order_id ∈ Ziel-Aufträge.
delete from public.booklets
where business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
  and order_id in (
    select o.id from public.orders o
    where o.business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
      and o.external_ref in ('N1401','N1400','N1396','N1394')
  );

-- 6) orders — Eltern-Zeilen zuletzt. Scope: business_id + external_ref.
delete from public.orders
where business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
  and external_ref in ('N1401','N1400','N1396','N1394');

commit;


-- ============================================================================
-- SCHRITT 4 — VERIFIKATION (NUR LESEN). Nach dem Delete ausführen.
-- Erwartung: 0 Zeilen aus SCHRITT 1 (s. o. nochmal laufen lassen) UND die
-- folgenden Reste-Checks liefern jeweils 0.
-- ============================================================================
select
  (select count(*) from public.orders o
     where o.business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
       and o.external_ref in ('N1401','N1400','N1396','N1394'))            as orders_rest,
  (select count(*) from public.analytics_events ae
     where ae.business_id = (select id from public.businesses where business_email = 'office@alinadax.com')
       and ae.external_ref in ('N1401','N1400','N1396','N1394'))           as analytics_rest;
