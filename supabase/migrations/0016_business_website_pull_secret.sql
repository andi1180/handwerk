-- 0016_business_website_pull_secret.sql — Valooro Handwerk: Secret für den
-- lesenden Website-Abruf (Pull).
-- ANWENDUNG: manuell im Supabase-SQL-Editor des Handwerk-Projekts. NICHT lokal ausführen.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ZWECK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Die öffentliche Website des Betriebs (Repo atelier-dax-web) HOLT sich alle
-- 15 Minuten die Aufträge mit `website_visible = true` ab. Handwerk sendet
-- nichts: kein Webhook, kein ausgehender Call, keine Zustandsänderung. Der
-- Abruf läuft über `GET /api/website/orders` und authentifiziert sich mit
-- diesem Secret als `Authorization: Bearer <secret>`.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ WARUM EINE ZWEITE SPALTE — businesses.webhook_secret WIRD NICHT MITBENUTZT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `webhook_secret` (0001) sichert den EINGEHENDEN roapp-Webhook: es liegt in
-- roapps Konfiguration und steht in der Webhook-URL. `website_pull_secret`
-- sichert den AUSGEHEND ABGERUFENEN Lesekanal: es liegt in der Umgebung des
-- Website-Deployments.
--
-- Zwei Richtungen, zwei fremde Systeme, zwei Aufbewahrungsorte. Ein geteiltes
-- Secret hieße: wer eines davon erbeutet, kann BEIDES — Aufträge anlegen und
-- ausliefern lassen (Webhook) UND den kompletten Auftragsbestand samt
-- signierter Foto-Adressen auslesen (Pull). Getrennt lässt sich außerdem eines
-- rotieren, ohne das andere anzufassen.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ENTWURFSENTSCHEIDUNGEN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- NULLABLE ohne Default: Ein Betrieb ohne Website hat kein Secret, und ein
-- automatisch vergebenes wäre ein offener Lesekanal, den niemand bestellt hat.
-- Der Endpunkt löst NULL nie auf (siehe unten) — ein Betrieb ohne Secret ist
-- über ihn nicht erreichbar.
--
-- ⚠️ PARTIELLER UNIQUE-INDEX über die NICHT-NULL-Werte: Das Secret ist die
--    Vertrauensquelle (§14.2) — aus ihm wird die `business_id` aufgelöst. Zwei
--    Betriebe mit demselben Secret wären eine stille Mandanten-Verletzung: der
--    Endpunkt löst über `maybeSingle()` auf und bekäme bei einem Duplikat
--    entweder einen Fehler oder — je nach Reihenfolge — den FALSCHEN Betrieb.
--    Der Index macht das unmöglich, statt sich auf `gen_random_uuid()` zu
--    verlassen. `webhook_secret` hat diesen Schutz aus 0001 NICHT; das ist eine
--    bestehende Lücke und wird hier bewusst nicht mitgeändert (fremder Pfad).
--
-- Partiell (`where website_pull_secret is not null`), weil NULL in einem
-- gewöhnlichen Unique-Index zwar mehrfach erlaubt wäre, der partielle Index
-- aber kleiner ist und die Absicht ausspricht: eindeutig sind die gesetzten.
--
-- KEINE neue Policy/GRANT nötig: `businesses` ist RLS-aktiv aus 0001. Die
-- Spalte wird ausschließlich über `service_role` gelesen (der Endpunkt hat
-- keinen Session-Kontext) — die bestehenden Policies führen keine Spaltenliste.
--
-- ⚠️ Die member-Policy auf `businesses` erlaubt Mitgliedern ein `select *` auf
--    den EIGENEN Betrieb. Das Secret ist damit für eingeloggte Mitarbeiter des
--    Betriebs lesbar — wie `webhook_secret` seit 0001 auch. Das ist hingenommen
--    (es ist ihr eigener Betrieb, und `getCurrentBusiness` selektiert ohnehin
--    eine feste Spaltenliste ohne beide Secrets), aber es gehört benannt: eine
--    Spalten-Ebene-Absicherung gibt es in Postgres-RLS nicht.

alter table public.businesses
  add column website_pull_secret text;

create unique index businesses_website_pull_secret_key
  on public.businesses (website_pull_secret)
  where website_pull_secret is not null;

comment on column public.businesses.website_pull_secret is
  'Secret für den lesenden Website-Abruf GET /api/website/orders (Authorization: Bearer). Vertrauensquelle: löst die business_id auf (§14.2). NULL = kein Lesekanal; der Endpunkt löst NULL nie auf. NICHT identisch mit webhook_secret (eingehender roapp-Webhook) — zwei Richtungen, zwei Aufbewahrungsorte, getrennt rotierbar. Setzen: supabase/scripts/set_website_pull_secret.sql';
