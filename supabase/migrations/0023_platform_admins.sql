-- 0023: platform_admins — globale Rolle, ausserhalb von business_users
-- (ROLLOUT_PFLICHTENHEFT.md 4.2). NICHT in business_users.role, weil
-- diese Tabelle strukturell an EINEN Betrieb gebunden ist
-- (business_id + role) - Andreas soll ALLE Betriebe sehen, nicht einer
-- Mitgliedschaftszeile pro Kundenbetrieb bedürfen.
--
-- LEKTION AUS 0021/0022 direkt hier angewendet, nicht nachkorrigiert:
-- revoke all VOR den gezielten GRANTs, explizit auch fuer authenticated
-- (nicht nur anon/public).

create table platform_admins (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table platform_admins is
  'Globale Plattform-Admin-Rolle (Andreas), unabhaengig von business_users. Vergabe ausschliesslich manuell per SQL/service_role - kein Self-Service, kein Code-Pfad zum Selbst-Befoerdern. Noch KEIN Aufrufer (A3), Verdrahtung folgt in A4.';

alter table platform_admins enable row level security;

revoke all on platform_admins from anon, public, authenticated;

create policy platform_admins_select on platform_admins
  for select
  to authenticated
  using (user_id = auth.uid());
-- Jeder darf nur sehen, OB er selbst Admin ist - nicht die ganze Liste.
-- Kein INSERT/UPDATE/DELETE fuer authenticated, keine Policy dafuer -
-- RLS blockt kategorisch, service_role ist der einzige Schreibweg.

grant select on platform_admins to authenticated;
grant all on platform_admins to service_role;

-- Backfill DEFENSIV: schlaegt NICHT fehl, falls andreas.dax@gmail.com
-- noch keine auth.users-Zeile hat - Tabelle/RLS/Rechte werden trotzdem
-- angelegt, nur der Eintrag selbst wird dann uebersprungen (mit
-- NOTICE), statt die ganze Migration per FK-Fehler abzubrechen.
do $$
declare
  admin_user_id uuid;
begin
  select id into admin_user_id
  from auth.users
  where email = 'andreas.dax@gmail.com';

  if admin_user_id is not null then
    insert into platform_admins (user_id) values (admin_user_id)
      on conflict (user_id) do nothing;
  else
    raise notice 'andreas.dax@gmail.com hat noch keine auth.users-Zeile - platform_admins bleibt vorerst leer. Backfill manuell nachholen, sobald diese Adresse sich einmal im Portal angemeldet hat (INSERT into platform_admins (user_id) select id from auth.users where email = ''andreas.dax@gmail.com'';).';
  end if;
end $$;
