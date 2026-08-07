-- set_website_pull_secret.sql — Website-Pull-Secret für EINEN Betrieb setzen.
--
-- ANWENDUNG: manuell im Supabase SQL-Editor (Handwerk-Projekt). KEINE Migration
-- (kein Schema-Change — businesses.website_pull_secret existiert aus 0016).
--
-- Das Secret authentifiziert den LESENDEN Abruf der Website:
--     GET https://handwerk.valooro.com/api/website/orders
--     Authorization: Bearer <website_pull_secret>
--
-- ⚠️ NICHT webhook_secret verwenden. Das sichert die andere Richtung (den
--    eingehenden roapp-Webhook) und liegt an einem anderen Ort. Begründung im
--    Kopf von supabase/migrations/0016_business_website_pull_secret.sql.
--
-- 1) Vor dem Ausführen die E-Mail-Adresse unten ersetzen (an ALLEN drei Stellen).
-- 2) Das UPDATE setzt nur ein Secret, wenn noch KEINS gesetzt ist
--    (`website_pull_secret is null`) — bestehende Secrets werden NIE
--    überschrieben. Ein versehentlicher zweiter Lauf dreht damit nicht still
--    den Zugang der laufenden Website ab.
-- 3) Das SELECT liest das Secret aus, um es in der Umgebung des
--    Website-Deployments zu hinterlegen (dort OHNE `NEXT_PUBLIC_`-Präfix —
--    es wird ausschließlich serverseitig gebraucht).

-- Secret erzeugen (nur wenn noch keins existiert):
update public.businesses
set website_pull_secret = gen_random_uuid()::text
where business_email = 'office@alinadax.com'
  and website_pull_secret is null;

-- Secret auslesen (zum Eintragen in der Website-Umgebung):
select business_email, website_pull_secret
from public.businesses
where business_email = 'office@alinadax.com';

-- ─────────────────────────────────────────────────────────────────────────
-- ROTIEREN — nur bewusst und mit Ausfall.
--
-- Das UPDATE oben überschreibt absichtlich nicht. Soll ein Secret wirklich
-- gewechselt werden (Verdacht auf Leck), erst auf null setzen, dann das UPDATE
-- oben erneut laufen lassen und den neuen Wert in der Website-Umgebung
-- eintragen. ⚠️ Zwischen beiden Schritten liefert der Endpunkt der Website 404
-- — sie zeigt dann ihren letzten Stand weiter (sie hat die Stücke bereits
-- übernommen), holt aber nichts Neues.
--
-- update public.businesses
-- set website_pull_secret = null
-- where business_email = 'office@alinadax.com';
-- ─────────────────────────────────────────────────────────────────────────
