-- 0010_media_category.sql — Valooro Handwerk: Bild-Kategorie für den Booklet-Aufbau.
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts. NICHT lokal ausführen.
--
-- Zweck: Jedes BILD bekommt eine Kategorie, die den festen Booklet-Aufbau steuert:
--   before  — EIN Vorher-/Ausgangszustand-Bild pro Auftrag (max 1, App-enforced), optional.
--             Im Booklet IMMER direkt nach dem Intro.
--   after   — EIN Nachher-/Ergebnis-Bild pro Auftrag (max 1, App-enforced), optional.
--             Im Booklet IMMER zuletzt, direkt vor dem Outro.
--   process — der Standard (Default) und die Pflicht-Kategorie fürs Generieren: ohne
--             mindestens EIN process-Medium ist kein Booklet erstellbar. Beliebig viele.
--
-- VIDEOS sind IMMER 'process' (kein before/after für Videos) — der Default deckt das ab,
-- und die App setzt für Videos keine andere Kategorie.
--
-- before/after sind je auf max 1 pro Auftrag begrenzt — das wird in der App erzwungen
-- (Upload-/Kategorie-Wechsel-Route + UI), NICHT per DB-Constraint (ein partieller Unique-
-- Index wäre möglich, ist hier aber bewusst nicht nötig: reine Testphase, ein einziger
-- schreibender Server-Pfad pro Order, und der Default 'process' kollidiert nie).
--
-- NOT NULL + Default 'process': bestehende Zeilen werden auf 'process' gesetzt (korrekt —
-- alle Altmedien sind Prozess-Bilder). KEINE neue Policy/GRANT — `order_media` ist RLS-aktiv
-- (0001, `for all`), die member-Policy + `service_role` decken die neue Spalte.

alter table public.order_media
  add column category text not null default 'process'
    check (category in ('before','after','process'));

comment on column public.order_media.category is
  'Bild-Kategorie für den Booklet-Aufbau. before/after je max 1 pro Auftrag (App-enforced), optional; im Booklet before direkt nach dem Intro, after zuletzt vor dem Outro. process ist der Standard und Pflicht fürs Generieren. Videos immer process.';
