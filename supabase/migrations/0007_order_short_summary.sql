-- 0007_order_short_summary.sql — Valooro Handwerk: KI-Kurzbeschreibung auf der Auftragskachel.
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts. NICHT lokal ausführen.
--
-- Zweck: ein sehr kurzer, KI-generierter Einzeiler (Art der Arbeit, ~3–6 Wörter), damit
-- Mitarbeiter in der Auftragsliste auf einen Blick sehen, worum es geht. Wird EINMALIG bei
-- der Auftragsanlage aus `orders.item_description` (bzw. dem roapp-Roh-Text) via Haiku erzeugt
-- und gespeichert — NICHT beim Rendern der Liste (sonst ein KI-Call pro Kachel pro Aufruf).
-- Nullable + Default null: scheitert/entfällt die Generierung (leere Notiz, KI-Fehler), bleibt
-- das Feld null und die Kachel zeigt einen dezenten Platzhalter.

alter table public.orders
  add column short_summary text default null;

comment on column public.orders.short_summary is
  'KI-generierte Kurzbeschreibung der Änderung für die Auftragskachel (aus item_description via Haiku, bei Anlage einmalig erzeugt).';
