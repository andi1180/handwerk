-- Verify-Gate 0020 — manuell im SQL-Editor NACH der Migration ausfuehren.

-- 1) Tabellenweite Berechtigung ist weg (erwartet: 0 Zeilen)
select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'businesses'
  and grantee = 'authenticated'
  and privilege_type = 'UPDATE';

-- 2) Die sechs neuen Spalten NICHT schreibbar (erwartet: alle false)
select column_name,
  has_column_privilege('authenticated','businesses',column_name,'UPDATE') as darf_schreiben
from information_schema.columns
where table_name = 'businesses'
  and column_name in ('tier','subscription_status','trial_ends_at',
    'current_period_end','stripe_subscription_id','entitlement_overrides');

-- 3) Bestehende, unveraenderte Spalten weiterhin schreibbar (erwartet: alle true)
select column_name,
  has_column_privilege('authenticated','businesses',column_name,'UPDATE') as darf_schreiben
from information_schema.columns
where table_name = 'businesses'
  and column_name in ('name','branding','settings','retention_months',
    'business_email','slug','status','default_language','consent_text',
    'stripe_customer_id','webhook_secret');

-- 4) service_role weiterhin uneingeschraenkt (erwartet: alle true)
select column_name,
  has_column_privilege('service_role','businesses',column_name,'UPDATE') as darf_schreiben
from information_schema.columns
where table_name = 'businesses'
  and column_name in ('tier','subscription_status','trial_ends_at',
    'current_period_end','stripe_subscription_id','entitlement_overrides');
