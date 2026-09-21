-- 0021: tier_definitions — Tier-Inhalte als Daten (E9), additiv.
-- Neue, eigenstaendige Tabelle: plattformweite Referenzdaten (KEINE
-- Mandanten-Tabelle, keine business_id-Spalte, kein RLS-Filter noetig
-- ausser dem Lese-Recht selbst).
--
-- LEKTION AUS 0019/0020: Supabase grantet per Default breit an
-- anon/authenticated -> defensiv revoke all, dann gezielt grant.
-- Diese Tabelle ist NEU (kein Erbe wie businesses aus 0001), das
-- table-weite-Grant-Problem von 0019 betrifft sie nicht - trotzdem
-- wird unten in Teil 2 explizit gegengeprueft, nicht nur angenommen.

create table tier_definitions (
  tier text primary key,
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table tier_definitions is
  'Tier-Inhalte als Daten (E9, ROLLOUT_PFLICHTENHEFT.md 4.1) - welche Limits/Features zu welchem Tier gehoeren, aenderbar ohne Deploy. Noch KEIN Aufrufer (A2). Werte aktuell Platzhalter, siehe Spaltenkommentare.';

alter table tier_definitions
  add constraint tier_definitions_tier_check
    check (tier in ('WOM Starter','WOM Plus','WOM Pro'));
-- Bewusst dieselbe Werteliste wie businesses_tier_check (0019), nicht
-- per Fremdschluessel verknuepft - 0019 ist bereits produktiv
-- angewendet, eine FK-Umstellung dort ist nicht Teil dieses Schritts.
-- Aendert sich einer der drei Namen, muessen BEIDE Stellen angepasst
-- werden.

alter table tier_definitions enable row level security;

revoke all on tier_definitions from anon, public;

create policy tier_definitions_select on tier_definitions
  for select
  to authenticated
  using (true);
-- Kein business_id-Bezug: plattformweite Referenzdaten, jedes
-- eingeloggte Mitglied darf sie lesen (spaeter z.B. "was beinhaltet
-- mein Tier" in den Settings) - niemand darf sie schreiben.

grant select on tier_definitions to authenticated;
grant all on tier_definitions to service_role;

create trigger tier_definitions_set_updated_at
  before update on tier_definitions
  for each row execute function set_updated_at();
-- set_updated_at() existiert bereits (0001, SECURITY INVOKER, auch auf
-- businesses/orders/booklets im Einsatz) - hier wiederverwendet, nicht
-- neu definiert.

insert into tier_definitions (tier, limits, features) values
  ('WOM Starter', '{}'::jsonb, '{}'::jsonb),
  ('WOM Plus',    '{}'::jsonb, '{}'::jsonb),
  ('WOM Pro',     '{}'::jsonb, '{}'::jsonb);

comment on column tier_definitions.limits is
  'PLATZHALTER (O1/O2/O3 offen, ROLLOUT_PFLICHTENHEFT.md): alle drei Tiers leer = lib/entitlements faellt fuer jeden Limit-Key auf Plattform-Obergrenze + Betriebs-Einstellung zurueck, kein Unterschied zwischen den Tiers, kein Verhaltensunterschied zu heute. Echte Werte erst nach O1-O3, gepflegt ueber Backoffice (A4) - bis dahin manuell per SQL.';
comment on column tier_definitions.features is
  'PLATZHALTER, siehe limits-Kommentar. Leer = kein Feature ist heute an ein Tier gebunden.';
