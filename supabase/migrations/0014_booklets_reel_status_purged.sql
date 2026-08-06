-- 0014_booklets_reel_status_purged.sql — Valooro Handwerk: Reel-Status 'purged'.
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts. NICHT lokal ausführen.
--
-- Aus Speicherplatzgründen wurden für abgeschlossene Aufträge die Medien aus dem
-- Bucket `order-media` entfernt (order_media-Zeilen + Quelldateien + reel.mp4 +
-- business-reel.mp4 + Frame-Vorschaubilder). Die orders- und booklets-Zeilen sowie
-- die komplette Analytics-Historie (booklet_events) BLEIBEN erhalten.
--
-- Damit fehlt dem Lifecycle ein Zustand: die betroffenen Booklets stehen weiterhin
-- auf reel_status='ready', obwohl die Datei nicht mehr existiert. Das ist irreführend
-- (Portal zeigt „✓ Reel erstellt", der Link läuft ins Leere) und lässt sich mit den
-- bestehenden vier Werten nicht ausdrücken:
--
--   'pending' wäre FALSCH — das bedeutet „noch nie gerendert" und suggeriert, ein
--             Render sei nachholbar. Die Quellmedien sind weg, ein erneuter Render
--             scheitert an need_media/need_process.
--   'failed'  wäre FALSCH — das bedeutet „Render ist schiefgegangen" (reel_error
--             trägt den Grund) und lädt zum Retry ein.
--
-- Deshalb der neue, terminale Wert:
--
--   'purged'  = Medien bewusst gelöscht. Es gab ein fertiges Reel, es existiert
--               nicht mehr, und es ist NICHT neu renderbar. Endzustand.
--
-- Diese Migration ERWEITERT NUR die beiden CHECK-Constraints (drop/add, exakt wie
-- 0005 für businesses.status und 0011 für orders.status) und setzt anschließend die
-- bereits bereinigten Aufträge auf den neuen Wert. KEINE neue Spalte/Tabelle/Policy/
-- GRANT — booklets-RLS und die Grants aus 0001 decken die Spalten unverändert ab.
--
-- Die beiden Constraint-Namen stammen aus der automatischen Postgres-Benennung der
-- inline-CHECKs in 0004 (reel_status) und 0013 (business_reel_status) und wurden
-- gegen die Live-DB verifiziert.
--
-- ANWENDUNGS-REIHENFOLGE: Block 1 zuerst (sonst lehnt der alte Constraint die
-- UPDATEs in Block 2 mit 23514 ab).


-- ============================================================================
-- BLOCK 1 — Constraints um 'purged' erweitern (drop/add wie 0005/0011).
-- ============================================================================

-- reel_status: Kunden-Reel (aus 0004).
alter table public.booklets
  drop constraint if exists booklets_reel_status_check;

alter table public.booklets
  add constraint booklets_reel_status_check
  check (reel_status in ('pending', 'rendering', 'ready', 'failed', 'purged'));

-- business_reel_status: Betriebs-IG-Reel (aus 0013).
alter table public.booklets
  drop constraint if exists booklets_business_reel_status_check;

alter table public.booklets
  add constraint booklets_business_reel_status_check
  check (business_reel_status in ('pending', 'rendering', 'ready', 'failed', 'purged'));


-- ============================================================================
-- BLOCK 2 — Nachlauf für die 15 bereits medien-bereinigten Aufträge.
--
-- Die Auftrags-IDs sind Primärschlüssel (global eindeutig) — eine zusätzliche
-- Eingrenzung auf business_id ist hier, anders als bei external_ref-basierten
-- Skripten, nicht nötig.
--
-- Beide UPDATEs sind defensiv auf den Ausgangswert 'ready' gefiltert. Das ist
-- kein Schönheitsfehler, sondern trägt die Löschregel: 'purged' heißt „es gab ein
-- fertiges Reel, das gelöscht wurde". Ein Booklet, dessen Betriebs-Reel nie
-- gerendert wurde, bleibt korrekt auf 'pending' — betroffen ist genau N1422
-- (d23eec53-…), dessen business_reel_status auf 'pending' steht und dort bleibt.
--
-- ERWARTETE ZEILENZAHLEN:  Block 2a = 15,  Block 2b = 14.
-- ============================================================================

-- 2a) Kunden-Reel: alle 15 standen auf 'ready'.
update public.booklets
set reel_status = 'purged'
where reel_status = 'ready'
  and order_id in (
    '99f72cbd-0d09-4473-8dbd-1104f3415ac6',  -- N1438
    'bfa3785a-9067-42d6-b9ec-344ef83a4817',  -- N1430
    '4115ec71-e32e-4dd3-914c-6962495f78b3',  -- N1428
    '268830dd-e994-4dd4-9486-91f1d472bc07',  -- N1427
    'd23eec53-2075-4c2c-bab3-b6a7765d0f6c',  -- N1422
    '23bc6ffe-bccf-4e23-bb99-3f744cdf73fb',  -- N1418
    'b609d8ec-65ec-46b7-812c-e3ecb86f8fd4',  -- N1414
    '6d4f9193-ee37-4cd2-88cc-bb5c2fba89a4',  -- N1413
    'ff32df0a-c67b-447a-8c09-1dc8abc6c623',  -- N1411
    '96e0d55a-fc1e-499b-98f3-123bee44bf63',  -- N1407
    'd752ae12-2860-4750-9839-7402f82c3fa4',  -- N1398
    '0b5da113-9393-4d23-9ff9-894f3217d780',  -- N1397
    '7de4a776-3384-418b-a3f5-15ed144e3288',  -- N1393
    '2f4152bd-abe5-47d9-ae48-43af83ff6a4b',  -- N1381
    '84def70a-b819-4fcd-b51a-a614138020cc'   -- N1314
  );

-- 2b) Betriebs-Reel: 14 von 15 standen auf 'ready'.
--     N1422 (d23eec53-…) steht auf 'pending' (nie gerendert) und bleibt dort —
--     der 'ready'-Filter sorgt dafür, ohne die ID gesondert auszunehmen.
update public.booklets
set business_reel_status = 'purged'
where business_reel_status = 'ready'
  and order_id in (
    '99f72cbd-0d09-4473-8dbd-1104f3415ac6',  -- N1438
    'bfa3785a-9067-42d6-b9ec-344ef83a4817',  -- N1430
    '4115ec71-e32e-4dd3-914c-6962495f78b3',  -- N1428
    '268830dd-e994-4dd4-9486-91f1d472bc07',  -- N1427
    'd23eec53-2075-4c2c-bab3-b6a7765d0f6c',  -- N1422 (steht auf 'pending' → bleibt)
    '23bc6ffe-bccf-4e23-bb99-3f744cdf73fb',  -- N1418
    'b609d8ec-65ec-46b7-812c-e3ecb86f8fd4',  -- N1414
    '6d4f9193-ee37-4cd2-88cc-bb5c2fba89a4',  -- N1413
    'ff32df0a-c67b-447a-8c09-1dc8abc6c623',  -- N1411
    '96e0d55a-fc1e-499b-98f3-123bee44bf63',  -- N1407
    'd752ae12-2860-4750-9839-7402f82c3fa4',  -- N1398
    '0b5da113-9393-4d23-9ff9-894f3217d780',  -- N1397
    '7de4a776-3384-418b-a3f5-15ed144e3288',  -- N1393
    '2f4152bd-abe5-47d9-ae48-43af83ff6a4b',  -- N1381
    '84def70a-b819-4fcd-b51a-a614138020cc'   -- N1314
  );
