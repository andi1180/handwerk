-- Verifikations-Gate zu Migration 0016 (Website-Pull-Secret).
-- Im SQL-Editor des Handwerk-Projekts ausführen, NACH dem Anwenden von 0016.

-- 1) Spalte vorhanden, Typ text, NULLABLE, ohne Default? (erwartet: 1 Zeile,
--    data_type = text, is_nullable = YES, column_default = NULL)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'businesses'
  and column_name = 'website_pull_secret';

-- 2) Partieller Unique-Index vorhanden? (erwartet: 1 Zeile, indexdef enthält
--    UNIQUE und WHERE (website_pull_secret IS NOT NULL))
--    ⚠️ Ohne ihn wäre ein doppeltes Secret eine stille Mandanten-Verletzung —
--    der Endpunkt löst über maybeSingle() auf und bekäme den falschen Betrieb.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'businesses'
  and indexname = 'businesses_website_pull_secret_key';

-- 3) Der Index greift wirklich? (erwartet: FEHLER 23505 auf dem zweiten Insert)
--    Zwei Betriebe mit demselben Secret dürfen nicht anlegbar sein.
--    In einer Transaktion, die zurückgerollt wird — es bleibt nichts stehen.
begin;
insert into public.businesses (name, business_email, slug, website_pull_secret)
values ('Verify A', 'verify-a@invalid.test', 'verify-a', 'verify-duplikat-secret');
insert into public.businesses (name, business_email, slug, website_pull_secret)
values ('Verify B', 'verify-b@invalid.test', 'verify-b', 'verify-duplikat-secret');
rollback;

-- 4) Mehrere Betriebe OHNE Secret bleiben erlaubt? (erwartet: beide Inserts
--    gehen durch — der Index ist partiell, NULL kollidiert nicht.)
begin;
insert into public.businesses (name, business_email, slug)
values ('Verify C', 'verify-c@invalid.test', 'verify-c');
insert into public.businesses (name, business_email, slug)
values ('Verify D', 'verify-d@invalid.test', 'verify-d');
rollback;

-- 5) Die beiden Secrets sind WIRKLICH getrennt? (erwartet: 0 Zeilen)
--    Ein Betrieb, bei dem Webhook- und Pull-Secret denselben Wert tragen, wäre
--    genau die Vermischung, die 0016 verhindern soll.
select business_email
from public.businesses
where website_pull_secret is not null
  and website_pull_secret = webhook_secret;

-- 6) Keine Grants für anon auf businesses? (erwartet: 0 Zeilen — stehender
--    Check aus 0001, hier wiederholt, weil die neue Spalte ein Secret trägt.)
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name = 'businesses';

-- 7) Bestand: wer hat welchen Kanal? (rein informativ, KEINE Secrets ausgeben)
select business_email,
       webhook_secret is not null      as hat_webhook_secret,
       website_pull_secret is not null as hat_website_pull_secret
from public.businesses
order by business_email;
