-- Migration 0013: Betriebs-IG-Reel-Spalten auf booklets
-- Additiv only. Keine neue Policy/GRANT nötig:
-- booklets_select/booklets_update prüfen nur Mitgliedschaft (keine Column-List),
-- grant select,update on booklets to authenticated ist table-level,
-- grant all to service_role deckt die neuen Spalten automatisch.

alter table public.booklets
  add column business_reel_status text not null default 'pending'
    check (business_reel_status in ('pending','rendering','ready','failed')),
  add column business_reel_url    text,
  add column business_reel_error  text,
  add column business_reel_shared_at timestamptz;
