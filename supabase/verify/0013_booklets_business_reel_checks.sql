-- Verify-Gate für Migration 0013
-- Im Supabase SQL-Editor ausführen, nachdem 0013 appliziert wurde.
-- Erwartetes Ergebnis: 4 Zeilen, eine je Spalte.

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'booklets'
  and column_name  in (
    'business_reel_status',
    'business_reel_url',
    'business_reel_error',
    'business_reel_shared_at'
  )
order by column_name;

-- Erwartete Zeilen (Reihenfolge alphabetisch):
-- business_reel_error     | text             | YES | (null)
-- business_reel_shared_at | timestamp with time zone | YES | (null)
-- business_reel_status    | text             | NO  | 'pending'::text
-- business_reel_url       | text             | YES | (null)
