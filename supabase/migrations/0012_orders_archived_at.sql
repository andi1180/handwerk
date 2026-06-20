-- 0012_orders_archived_at.sql
-- Additiv: neue Spalte orders.archived_at (timestamptz, nullable).
-- NULL = aktiv, Timestamp = archiviert. Orthogonal zum Status-Feld —
-- ein Auftrag kann in jedem Status archiviert werden.
--
-- Kein ALTER/DROP an Bestehendem; KEINE neue Policy/GRANT nötig:
-- orders ist RLS-aktiv aus 0001, die bestehenden member-Policies
-- und service_role decken die Spalte automatisch ab.

ALTER TABLE public.orders
  ADD COLUMN archived_at timestamptz;

COMMENT ON COLUMN public.orders.archived_at IS
  'NULL = aktiv, Timestamp = archiviert. Orthogonal zum status-Feld.';
