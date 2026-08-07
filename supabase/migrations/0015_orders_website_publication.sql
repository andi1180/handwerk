-- 0015_orders_website_publication.sql — Valooro Handwerk: Website-Veröffentlichung.
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts. NICHT lokal ausführen.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ZWECK — VORBEREITENDER BAUSTEIN, KEINE ANBINDUNG
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Diese fünf Spalten erfassen, welche Aufträge später auf der öffentlichen
-- Website des Betriebs (atelier-dax-web, Archiv /verwandlungen) erscheinen
-- sollen, und mit welchen Angaben. Sie werden AUSSCHLIESSLICH in Handwerks
-- eigener DB gespeichert.
--
-- ⚠️ ES EXISTIERT KEINE ÜBERTRAGUNG: kein API-Call, kein Webhook, kein Versand
--    von Fotos/Videos an eine externe Stelle. Nichts liest diese Spalten außer
--    der Handwerk-Detailseite selbst. Eine echte Anbindung ist ein späterer,
--    eigener Schritt.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ NAMENSKOLLISION — website_category ≠ order_media.category
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `order_media.category` (Migration 0010) ist die BILD-Einteilung eines
-- Mediums für den Booklet-Aufbau: before / after / process.
--
-- `orders.website_category` ist etwas völlig anderes: die ART DER ARBEIT für
-- das Website-Archiv (Änderung / Redesign / Upcycling). Sie hängt am AUFTRAG,
-- nicht am Medium, und hat einen disjunkten Wertebereich — die beiden können
-- nicht verwechselt werden, solange der Präfix `website_` mitgelesen wird.
-- Die Oberfläche beschriftet das Feld deshalb konsequent „Website-Kategorie",
-- nie nur „Kategorie".
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WERTEBEREICHE — aus dem Website-Repo übernommen, nicht erfunden
-- ═══════════════════════════════════════════════════════════════════════════
--
-- website_category spiegelt das Enum `verwandlungsart` des Website-Repos
-- (atelier-dax-web, lib/database.types.ts):
--     'aenderung' | 'redesign' | 'upcycling'
-- Der Wertebereich ist klein und stabil → hier als CHECK-Constraint verankert
-- (Defense in depth zusätzlich zur App-Validierung).
--
-- website_clothing_type spiegelt das Enum `kleidungsart` desselben Repos
-- (lib/kleidungsarten.ts + Migrationen 0005/0031/0032/0035), Stand 07.08.2026:
--     'mantel' | 'jacke_gilet' | 'kleid' | 'hose' | 'rock' | 'anzug'
--     | 'sakko' | 'bluse' | 'pullover' | 'sonstiges'
--
-- ⚠️ BEWUSST OHNE CHECK-CONSTRAINT: Dieses Enum WÄCHST drüben per Migration
--    (0031 jacke_gilet, 0032 pullover, 0035 sakko — drei Ergänzungen in zwei
--    Wochen). Ein CHECK hier bedeutete eine Handwerk-Migration bei jeder
--    Website-Ergänzung, und ein vergessener Nachzug würde gültige Werte
--    abweisen. Die eine Quelle ist stattdessen die App-Liste in
--    lib/orders/website.ts; der Route Handler validiert dagegen.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ENTWURFSENTSCHEIDUNGEN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- website_visible NOT NULL DEFAULT false: Der Standard ist „nicht auf der
-- Website". Bestehende Aufträge werden dadurch alle korrekt auf false gesetzt
-- — niemand landet ungefragt im öffentlichen Archiv. Dass ein einmal auf true
-- gesetzter Auftrag aus der Handwerk-Oberfläche nicht mehr auf false
-- zurückgeschaltet werden kann, ist eine APP-Regel (Route Handler + UI), kein
-- DB-Constraint: der Betreiber muss den Zustand per SQL korrigieren können,
-- wenn es einmal nötig ist.
--
-- website_category DEFAULT 'aenderung': wie in der Vorgabe verlangt. Folge:
-- bestehende Zeilen tragen 'aenderung'. Das ist bedeutungslos, solange
-- website_visible = false — der Wert wird nirgends gelesen und nichts wird
-- sichtbar. Erst mit dem Einschalten wird er zur bewussten Angabe.
--
-- website_work_hours / website_price als numeric, nullable, OHNE CHECK: Die
-- Pflicht („beide > 0, sobald sichtbar") ist eine Zustandsregel, die nur im
-- Zusammenspiel mit website_visible gilt — sie gehört in den Route Handler,
-- der den Zustandsübergang ohnehin prüft. Ein DB-CHECK müsste website_visible
-- mitlesen und würde bestehende Zeilen (alle NULL) sofort verletzen.
--
-- ⚠️ Zum späteren Abgleich: Die Website führt den Preis als `preis_cent`
--    (integer, CENT). Hier steht ein numerischer EURO-Betrag. Eine spätere
--    Anbindung muss umrechnen (× 100), nicht durchreichen.
--
-- KEINE neue Policy/GRANT nötig: `orders` ist RLS-aktiv aus 0001; die
-- bestehenden member-Policies (`for all`) und `service_role` decken die neuen
-- Spalten automatisch ab — die Policies führen keine Spaltenliste.

alter table public.orders
  add column website_visible boolean not null default false,
  add column website_category text default 'aenderung'
    check (website_category in ('aenderung', 'redesign', 'upcycling')),
  add column website_clothing_type text,
  add column website_work_hours numeric,
  add column website_price numeric;

comment on column public.orders.website_visible is
  'Soll dieser Auftrag auf der öffentlichen Website erscheinen? Standard false. Einmal true, aus der Handwerk-Oberfläche nicht mehr abschaltbar (App-Regel, kein DB-Constraint). KEINE Übertragung implementiert — reine Erfassung.';

comment on column public.orders.website_category is
  'Art der Arbeit fürs Website-Archiv: aenderung/redesign/upcycling (Spiegel des Website-Enums verwandlungsart). NICHT zu verwechseln mit order_media.category (before/after/process) — das ist die Bild-Einteilung im Booklet.';

comment on column public.orders.website_clothing_type is
  'Kleidungsart fürs Website-Archiv (Spiegel des Website-Enums kleidungsart: mantel, jacke_gilet, kleid, hose, rock, anzug, sakko, bluse, pullover, sonstiges). Bewusst ohne CHECK — das Enum wächst drüben per Migration; die eine Quelle ist lib/orders/website.ts.';

comment on column public.orders.website_work_hours is
  'Arbeitszeit in Stunden fürs Website-Archiv. Pflicht (> 0), sobald website_visible = true — App-Regel, kein DB-CHECK.';

comment on column public.orders.website_price is
  'Preis in EURO fürs Website-Archiv. Pflicht (> 0), sobald website_visible = true — App-Regel, kein DB-CHECK. ⚠️ Die Website führt preis_cent (integer, Cent): eine spätere Anbindung muss umrechnen.';
