-- 0011_orders_status_drop_finalized.sql — Valooro Handwerk: Status-Maschine vereinfacht.
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts. NICHT lokal ausführen.
--
-- Der separate Abschluss-Schritt `finalized` entfällt: ein einziger Klick
-- „Booklet erstellen" führt direkt `draft → generated` aus (finalize + generate
-- zusammengelegt). Die neue, schlankere Status-Maschine ist:
--
--     draft → generated → sent → viewed → shared
--
-- Diese Migration VERENGT NUR den CHECK-Constraint auf orders.status (entfernt
-- 'finalized'). Defense-in-depth: die App schreibt 'finalized' ohnehin nicht mehr
-- (Code-Änderung reicht funktional aus) — der Constraint hält einen versehentlichen
-- Schreibzugriff zusätzlich ab und spiegelt die neue Status-Maschine in der DB.
-- Der DEFAULT bleibt 'draft'. KEINE neue Tabelle/Policy/GRANT — nur der Constraint.
--
-- VORAUSSETZUNG: keine Zeile darf mehr im entfallenen Status 'finalized' stehen,
-- sonst würde das ADD CONSTRAINT scheitern. In der reinen Testphase gibt es keine;
-- der erste Schritt holt etwaige Alt-Zeilen sicherheitshalber auf 'draft' zurück
-- (dort sind sie editierbar, kein Booklet — der natürliche Ersatz für 'finalized').

-- 1) Etwaige Alt-Zeilen aus dem entfallenen Zwischenstatus auf 'draft' zurückholen.
update public.orders set status = 'draft' where status = 'finalized';

-- 2) Constraint verengen (drop/add, wie 0005 für businesses.status).
alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('draft', 'generated', 'sent', 'viewed', 'shared'));
