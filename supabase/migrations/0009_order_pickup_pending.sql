-- 0009_order_pickup_pending.sql — Valooro Handwerk: Warn-Flag „abgeholt, aber Booklet nicht versendet".
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts. NICHT lokal ausführen.
--
-- Zweck (Block C / Schritt 2): Meldet roapp einen Auftrag als „Abgeholt", OBWOHL bei uns noch
-- kein Booklet versendet wurde (Auftrag noch `draft`/`finalized`), hält dieses Feld den Zeitpunkt
-- fest. Der Kunde hat seine Sachen abgeholt, aber noch kein Booklet bekommen — der Betrieb soll
-- es fertigmachen und manuell senden. Treibt einen roten Warn-Badge auf der Auftragskachel.
--
-- Wird beim (manuellen) Versand wieder auf null gesetzt ⇒ Badge verschwindet. Kein Wert (null) =
-- keine Warnung. Nur bei `draft`/`finalized` gesetzt, NIE bei `sent`/`viewed`/`shared` (ein bereits
-- ausgeliefertes Booklet, das wegen Reparatur erneut „Abgeholt" wird, darf nicht warnen).
--
-- Nullable + Default null: bestehende Aufträge unverändert (keine Warnung). KEINE neue Policy/GRANT —
-- `orders` ist RLS-aktiv (0001, `for all`), die member-Policy + `service_role` decken die neue Spalte.

alter table public.orders
  add column picked_up_at timestamptz default null;

comment on column public.orders.picked_up_at is
  'Zeitpunkt, zu dem roapp ''Abgeholt'' meldete, OBWOHL noch kein Booklet versendet war (Auftrag draft/finalized). Treibt den Warn-Badge auf der Auftragskachel. Wird beim Versand auf null gesetzt. Kein Wert = keine Warnung.';
