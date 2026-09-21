-- 0022: Korrektur des Default-Grants aus 0021
-- Ursache: Supabase grantet neu erstellten Tabellen per Default breite
-- Rechte an authenticated (hier: INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER zusaetzlich zu SELECT). Die RLS-Policy aus 0021
-- (nur SELECT) schraenkt WELCHE ZEILEN sichtbar sind ein, nicht WELCHE
-- OPERATIONEN erlaubt sind - das ist weiterhin Sache des GRANT.
-- Gleiches Muster wie 0020 (dort: geerbtes tabellenweites GRANT auf
-- businesses), hier: frisches Default-GRANT auf einer neuen Tabelle.
-- LEKTION FUER KUENFTIGE MIGRATIONEN: jede neue Tabelle braucht IMMER
-- ein defensives "revoke all ... from anon, public, authenticated"
-- VOR den gezielten GRANTs - 0021 hatte das nur fuer anon/public, nicht
-- fuer authenticated.

revoke all on tier_definitions from authenticated;

grant select on tier_definitions to authenticated;
