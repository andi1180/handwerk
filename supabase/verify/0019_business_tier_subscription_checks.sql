-- Verify-Gate 0019 — manuell im SQL-Editor NACH der Migration ausfuehren.

-- 1) Spalten vorhanden, korrekte Nullability/Defaults
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'businesses'
  and column_name in ('tier','subscription_status','trial_ends_at',
    'current_period_end','stripe_subscription_id','entitlement_overrides')
order by column_name;
-- Erwartung: alle nullable=YES ausser entitlement_overrides (NO, default '{}'::jsonb)

-- 2) CHECK-Constraints korrekt
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'businesses'::regclass
  and conname in ('businesses_tier_check','businesses_subscription_status_check');

-- 3) authenticated darf die sechs neuen Spalten NICHT schreiben (erwartet: alle false)
select column_name,
  has_column_privilege('authenticated','businesses',column_name,'UPDATE') as darf_schreiben
from information_schema.columns
where table_name = 'businesses'
  and column_name in ('tier','subscription_status','trial_ends_at',
    'current_period_end','stripe_subscription_id','entitlement_overrides');

-- 4) service_role darf weiterhin alles (erwartet: alle true)
select column_name,
  has_column_privilege('service_role','businesses',column_name,'UPDATE') as darf_schreiben
from information_schema.columns
where table_name = 'businesses'
  and column_name in ('tier','subscription_status','trial_ends_at',
    'current_period_end','stripe_subscription_id','entitlement_overrides');

-- 5) Gegenprobe: unveraenderte Spalte weiterhin schreibbar fuer authenticated (erwartet: true)
select has_column_privilege('authenticated','businesses','name','UPDATE') as darf_name_schreiben;

-- 6) Backfill korrekt
select business_email, tier, subscription_status
from businesses
where business_email = 'office@alinadax.com';
-- Erwartung: tier='WOM Pro', subscription_status='active'

-- 7) Alle anderen Betriebe unangetastet
select business_email, tier, subscription_status
from businesses
where business_email <> 'office@alinadax.com';
-- Erwartung: tier IS NULL, subscription_status IS NULL in jeder Zeile
