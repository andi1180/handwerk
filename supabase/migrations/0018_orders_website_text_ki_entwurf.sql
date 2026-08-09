-- 0018_orders_website_text_ki_entwurf.sql — Valooro Handwerk: Kennzeichen „KI-Entwurf".
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts. NICHT lokal ausführen.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ZWECK — wer hat diesen Text geschrieben?
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Seit 0017 trägt jeder sichtbare Auftrag einen Text „Was wurde gemacht"
-- (`orders.website_text`), der drüben ins öffentliche Archiv geht. Bis jetzt
-- konnte er nur von Hand entstehen. Ab sofort schreibt die KI beim Umlegen des
-- Schalters einen ERSTEN ENTWURF aus den Bildunterschriften und der
-- Annahmenotiz — Alina korrigiert ihn, und korrigiert sie nicht, korrigiert
-- Andreas auf der Website.
--
-- Genau dafür ist diese Spalte da: Sie sagt, ob der aktuell gespeicherte Text
-- ein UNBEARBEITETER KI-Entwurf ist. Ohne sie wäre am Text nicht zu erkennen,
-- ob ihn je ein Mensch angesehen hat.
--
-- ⚠️ Die Spalte ist ein KENNZEICHEN, kein Schalter: Niemand setzt sie von Hand.
--    Sie wird ausschließlich vom Route Handler abgeleitet
--    (app/api/portal/orders/[id]/route.ts):
--
--      true  ⇐ der Text ist gerade erzeugt worden.
--      false ⇐ der gespeicherte Text weicht vom erzeugten Entwurf ab, wurde
--              also von Hand bearbeitet.
--
--    ⚠️ Ein Speichern OHNE Änderung am Text lässt das Kennzeichen stehen. Das
--       ist Absicht: Das Kennzeichen beantwortet „hat jemand diesen Text
--       angefasst?", nicht „hat jemand auf Speichern gedrückt?". Andreas soll
--       drüben sehen, welche Texte noch niemand geprüft hat.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BESTANDSSCHUTZ — `false` ist für jede bestehende Zeile die Wahrheit
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `not null default false` ist hier ausnahmsweise unbedenklich (anders als bei
-- `website_visible` in 0015, wo der Default den Bestand vor ungewollter
-- Veröffentlichung schützen musste): Jeder heute vorhandene `website_text`
-- wurde von Hand getippt — es gab bis jetzt gar keine Erzeugung. `false` ist
-- also keine Annahme, sondern die belegte Tatsache.
--
-- KEIN CHECK-Constraint nötig: boolean not null ist bereits der vollständige
-- Wertebereich.
--
-- KEINE neue Policy/GRANT nötig: `orders` ist RLS-aktiv aus 0001; die
-- bestehenden member-Policies (`for all`) und `service_role` decken die neue
-- Spalte automatisch ab — die Policies führen keine Spaltenliste.

alter table public.orders
  add column website_text_ki_entwurf boolean not null default false;

comment on column public.orders.website_text_ki_entwurf is
  'true, solange website_text ein UNBEARBEITETER KI-Entwurf ist. Wird ausschliesslich vom Route Handler abgeleitet (true beim Erzeugen, false sobald der gespeicherte Text vom Entwurf abweicht) - nie von Hand gesetzt. Ein Speichern ohne Textaenderung laesst das Kennzeichen bewusst stehen: es beantwortet "hat jemand den Text angefasst?", nicht "hat jemand gespeichert?".';
