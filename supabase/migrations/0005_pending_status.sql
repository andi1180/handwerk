-- 0005_pending_status.sql — Valooro Handwerk: Self-Service-Registrierung (Option C).
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts.
--
-- Neue Betriebe registrieren sich selbst (/register) und starten auf 'pending'.
-- Das Portal bleibt gesperrt (getCurrentBusiness ⇒ redirect /pending), bis ein
-- Admin den Betrieb manuell freischaltet:
--   update businesses set status='active' where business_email='...';
--
-- Diese Migration erweitert NUR den CHECK-Constraint auf businesses.status um
-- 'pending'. Der DEFAULT bleibt 'active' — bestehende Betriebe und manuell
-- angelegte Zeilen sind unverändert aktiv; nur der Registrierungs-Endpoint setzt
-- explizit status='pending'. KEINE neue Tabelle/Policy/GRANT nötig.

alter table public.businesses
  drop constraint if exists businesses_status_check;

alter table public.businesses
  add constraint businesses_status_check
  check (status in ('pending', 'active', 'suspended'));
