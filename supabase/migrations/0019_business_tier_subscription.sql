-- 0019: Tier-/Abo-Fundament auf businesses (additiv, Arbeitspaket A1)
-- Fünf neue Spalten + Entitlement-Override-Trägerspalte, spaltenweise
-- Schreibsperre für authenticated auf allen sechs (nur service_role
-- darf schreiben — Webhook/Backoffice, noch nicht gebaut). Kein
-- ALTER/DROP an Bestehendem.

alter table businesses
  add column tier text,
  add column subscription_status text,
  add column trial_ends_at timestamptz,
  add column current_period_end timestamptz,
  add column stripe_subscription_id text,
  add column entitlement_overrides jsonb not null default '{}'::jsonb;

alter table businesses
  add constraint businesses_tier_check
    check (tier is null or tier in ('WOM Starter','WOM Plus','WOM Pro'));

alter table businesses
  add constraint businesses_subscription_status_check
    check (subscription_status is null or subscription_status in
      ('trial','trial_ended','active','past_due','canceled'));

comment on column businesses.tier is
  'Gebuchtes Paket, nur der Name (E9) — Inhalte liegen im Backoffice/lib/entitlements, nicht hier.';
comment on column businesses.subscription_status is
  'Reiner Abo-Zustand. Sperrung laeuft ausschliesslich ueber businesses.status (pending/active/suspended, seit 0005) — bewusst getrennt, siehe ROLLOUT_PFLICHTENHEFT.md Abschnitt 5.';
comment on column businesses.trial_ends_at is
  'Ende der 1-monatigen Testphase ohne Kreditkarte.';
comment on column businesses.current_period_end is
  'Ende der aktuellen Abrechnungsperiode (Stripe-Spiegel).';
comment on column businesses.stripe_subscription_id is
  'Stripe-Subscription-ID. Abrechnungswahrheit bleibt Stripe, DB ist Durchsetzungswahrheit (Webhook haelt sie synchron).';
comment on column businesses.entitlement_overrides is
  'Betriebs-Ausnahme ueber der Tier-Vorgabe, unter der Plattform-Obergrenze (Rollout-Pflichtenheft 4.1). Leeres Objekt = keine Ausnahme.';

-- Schreibzugriff auf die sechs neuen Spalten NUR service_role.
-- businesses_update (RLS, seit 0001) hat keine Spaltenliste — Mitglieder
-- duerften sonst jede Spalte der eigenen Zeile schreiben, inkl. tier.
revoke update (
  tier,
  subscription_status,
  trial_ends_at,
  current_period_end,
  stripe_subscription_id,
  entitlement_overrides
) on businesses from authenticated;

-- Backfill: einziger Produktivbetrieb bekommt explizit Top-Tier + aktiv,
-- damit kuenftige Durchsetzung (A7) ihn nie unter den heutigen
-- Funktionsumfang faellt.
update businesses
  set tier = 'WOM Pro',
      subscription_status = 'active'
  where business_email = 'office@alinadax.com';
