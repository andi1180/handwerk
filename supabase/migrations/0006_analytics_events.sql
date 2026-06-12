-- 0006_analytics_events.sql — Valooro Handwerk: generisches Analytics-/Event-Fundament.
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts. NICHT lokal ausführen.
--
-- Zweck: eine schlanke, tabellarische Ablage für betriebs-skopierte Sach-Events, die
-- KEIN Abrechnungs- (billing_events) und KEIN Booklet-Interaktions-Event (booklet_events)
-- sind. Erster Konsument (§12-Connector): der roapp-Webhook schreibt bei der Auto-Anlage
-- den Roh-Beschreibungstext eines Auftrags als `order_description`-Event mit, damit der
-- Sachtext erhalten bleibt. Weitere Module schreiben künftig eigene `event_type`s in
-- DIESELBE Tabelle (z. B. KI-Generierungs-Telemetrie, Import-Quellen).
--
-- RLS-/GRANT-Stil EXAKT wie billing_events (0001): Mitglieder dürfen lesen, geschrieben
-- wird AUSSCHLIESSLICH serverseitig über service_role. KEIN INSERT/UPDATE/DELETE-Grant
-- für authenticated.
--
-- ============================================================================
-- ZWEI nicht verhandelbare Eigenschaften dieser Tabelle:
--
-- 1. RETENTION-FEST: analytics_events wird vom Retention-Löschjob (§13.4) NIEMALS
--    gelöscht. Anders als order_media/orders (an die 12-Monats-Retention gekoppelt)
--    bleiben diese Sach-Events dauerhaft erhalten. Sollte je ein Retention-Cleanup
--    gebaut werden, MUSS er analytics_events explizit ausnehmen.
--
-- 2. PII-FREI: `payload` und `external_ref` enthalten NIE Name/E-Mail/Telefon — nur
--    Sachtext (z. B. die Art der Arbeit) und technische Referenzen (z. B. die
--    Auftragsnummer `N1394`). Diese PII-Freiheit ist die BEDINGUNG für die
--    Retention-Ausnahme (1): dauerhaft halten ist nur zulässig, weil hier keine
--    personenbezogenen Daten liegen.
-- ============================================================================

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  event_type text not null,                       -- Sach-Event-Typ, z. B. 'order_description'
  source text not null,                           -- Herkunft, z. B. 'roapp'
  external_ref text,                              -- technische Referenz (z. B. id_label 'N1394'), KEINE PII
  payload jsonb not null default '{}'::jsonb,     -- Sachtext/technische Daten, KEINE PII
  created_at timestamptz not null default now()
);
create index idx_analytics_events_business_created on public.analytics_events(business_id, created_at);
create index idx_analytics_events_business_type on public.analytics_events(business_id, event_type);

-- RLS aktivieren.
alter table public.analytics_events enable row level security;

-- SELECT für Mitglieder (business_id über business_users gescoped) — Stil wie billing_events.
create policy analytics_events_select on public.analytics_events for select to authenticated
  using (exists (select 1 from public.business_users bu
                 where bu.business_id = analytics_events.business_id and bu.user_id = auth.uid()));

-- Defensiv: etwaige Default-Privilegien für anon/PUBLIC entfernen (Supabase grantet per Default an anon!).
revoke all on public.analytics_events from anon;
revoke all on public.analytics_events from public;

-- Explizite GRANTs: NUR SELECT für authenticated (kein INSERT/UPDATE/DELETE — Schreiben
-- läuft serverseitig über service_role). service_role hat volles Recht.
grant select on public.analytics_events to authenticated;
grant all on public.analytics_events to service_role;
