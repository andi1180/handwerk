-- 0004_reel_status.sql — Valooro Handwerk: Reel-Render-Lifecycle auf booklets.
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts.
--
-- Schritt 8b-1a: Das echte Reel wird asynchron in einem Hintergrund-Job (Next.js
-- after()) gerendert. booklets bekommt deshalb einen Status + ein Diagnosefeld,
-- damit der Fortschritt persistent ist (Poll + Seiten-Reload), nicht nur im
-- Client-State. reel_url (Storage-Pfad des fertigen Reels) existiert bereits aus 0001.
--
-- KEINE neue Policy/GRANT nötig: booklets ist RLS-aktiv (0001) — die member-
-- Policies (select/update für authenticated) und `service_role` (grant all) decken
-- die neuen Spalten automatisch ab. Der Render-Job schreibt über service_role.

alter table public.booklets
  add column if not exists reel_status text not null default 'pending'
    check (reel_status in ('pending','rendering','ready','failed')),
  add column if not exists reel_error text;

-- reel_status: 'pending' (noch nie gerendert) → 'rendering' (Job läuft) →
--              'ready' (reel_url gesetzt, abspielbar) | 'failed' (reel_error = Grund).
