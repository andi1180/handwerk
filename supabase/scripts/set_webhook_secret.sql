-- set_webhook_secret.sql — Inbound-Webhook-Secret für EINEN Betrieb setzen (§12).
--
-- ANWENDUNG: manuell im Supabase SQL-Editor (Handwerk-Projekt). KEINE Migration
-- (kein Schema-Change — businesses.webhook_secret existiert aus 0001).
--
-- 1) Vor dem Ausführen die E-Mail-Adresse unten ersetzen.
-- 2) Das UPDATE setzt nur ein Secret, wenn noch KEINS gesetzt ist
--    (`webhook_secret is null`) — bestehende Secrets werden NIE überschrieben.
-- 3) Das SELECT liest das Secret aus, um die Webhook-URL in roapp einzutragen:
--      https://handwerk.valooro.com/api/webhook/<webhook_secret>

-- Secret erzeugen (nur wenn noch keins existiert):
update public.businesses
set webhook_secret = gen_random_uuid()::text
where business_email = 'atelier@example.com'
  and webhook_secret is null;

-- Secret auslesen (zum Eintragen in roapp):
select business_email, webhook_secret
from public.businesses
where business_email = 'atelier@example.com';
