-- 0020: Korrektur der Schreibsperre aus 0019
-- Ursache: revoke update (spalten) on businesses from authenticated
-- wirkt nicht, weil authenticated aus 0001 eine TABELLENWEITE
-- UPDATE-Berechtigung auf businesses hat (keine Column-List). Postgres
-- prueft Spaltenzugriff additiv: Tabellen-Recht ODER Spalten-Recht
-- genuegt bereits. Ein spaltenweises REVOKE kann eine tabellenweite
-- GRANT nicht aufheben — nur eine eigene, vorher erteilte
-- Spalten-Berechtigung.
-- Fix: Tabellen-Update-Recht entziehen, dann jede bestehende Spalte
-- AUSSER den sechs sensiblen einzeln wieder freigeben (dynamisch per
-- information_schema ermittelt — keine Spalte manuell aufgezaehlt,
-- damit nichts vergessen wird und kuenftige Spalten automatisch NICHT
-- erfasst sind, falls diese Migration je als Vorlage dient).

revoke update on businesses from authenticated;

do $$
declare
  col text;
begin
  for col in
    select column_name
    from information_schema.columns
    where table_name = 'businesses'
      and column_name not in (
        'tier','subscription_status','trial_ends_at',
        'current_period_end','stripe_subscription_id',
        'entitlement_overrides'
      )
  loop
    execute format('grant update (%I) on businesses to authenticated', col);
  end loop;
end $$;
