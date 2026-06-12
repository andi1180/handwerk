# Sicherheits-Härtungsanalyse — Valooro Handwerk

**Stand:** 2026-06-12 · **Scope:** Pre-Pilot-Härtung vor echtem Kundenbetrieb.
**Kontext:** Ein Atelier (Atelier Dax), Single-Tenant-Realität, nicht-öffentliche
Webhook-URL, **Kunden-E-Mails + Kundenfotos die sensibelsten Daten**. Bewertung
auf *realistische* Risiken dieses Setups zugeschnitten — keine Enterprise-Szenarien.

**Diese Analyse ändert keinen Code.** Sie benennt nur Risiken, Fundstellen und Gegenmaßnahmen.

Geprüfte Dateien: [app/api/webhook/[secret]/route.ts](app/api/webhook/[secret]/route.ts),
[app/s/[code]/page.tsx](app/s/[code]/page.tsx), [app/b/[token]/page.tsx](app/b/[token]/page.tsx),
[app/api/b/[token]/event/route.ts](app/api/b/[token]/event/route.ts),
[app/api/auth/register/route.ts](app/api/auth/register/route.ts), [middleware.ts](middleware.ts),
ergänzend [lib/roapp/client.ts](lib/roapp/client.ts), [lib/booklet/load.ts](lib/booklet/load.ts),
[lib/booklet/short-code.ts](lib/booklet/short-code.ts), [lib/booklet/token.ts](lib/booklet/token.ts),
[lib/ai/intro.ts](lib/ai/intro.ts), [lib/ai/short-summary.ts](lib/ai/short-summary.ts).

**Gesamtbild:** Die Isolations-Architektur ist solide — `service_role` strikt
server-seitig, `business_id` durchgängig aus Token/Secret/Session statt aus dem
Payload (§14.2), React-Escaping verhindert XSS, Token-Entropie überdurchschnittlich.
Die realen Lücken sind **fehlendes Rate-Limiting** und der **per-Event KI-/API-Kostenhebel
am Webhook**, nicht die Datenisolation.

---

## 1. Webhook ohne HMAC

**Fundstelle:** [app/api/webhook/[secret]/route.ts:81-148](app/api/webhook/[secret]/route.ts#L81),
Anreicherung [lib/roapp/client.ts:150](lib/roapp/client.ts#L150).

### Auth-Modell heute
Einzige Authentifizierung ist das **Pfad-Secret** (`/api/webhook/<secret>`). Es wird per
`gen_random_uuid()` gesetzt ([supabase/scripts/set_webhook_secret.sql](supabase/scripts/set_webhook_secret.sql))
→ **122 bit Entropie**, praktisch nicht erratbar. Ungültiges Secret ⇒ 404 nach einer
indizierten DB-Abfrage. HMAC (`x-signature`) wird bewusst nicht geprüft (im Code dokumentiert).

### Realistischer Schaden — nur relevant, **wenn das Secret leakt**
Die URL ist ein Bearer-Secret im Klartext-Pfad. Leak-Wege im realen Betrieb: roapp-Logs/
Support, Vercel-/Proxy-Access-Logs, Referrer, versehentliches Teilen der Konfig, Browser-
History falls je im Browser geöffnet. Wer das Secret hat, kann **ohne weitere Hürde**:

- **`order.created` fluten** → pro Request: 1 roapp-API-Call (`GET /orders/{object_id}`,
  mit dem **globalen `ROAPP_API_KEY`** des Ateliers), bei vorhandener Beschreibung **1 Haiku-Call**
  (`generateShortSummary`, [route.ts:243](app/api/webhook/[secret]/route.ts#L243)) **+ DB-Inserts**
  (`orders`, `analytics_events`). `object_id` ist **frei wählbar** → der Angreifer benutzt den
  API-Key des Ateliers als Proxy, um beliebige roapp-Orders zu ziehen und als `orders`-Zeilen
  (inkl. fremder `customer_email`) in die DB zu schreiben. **Kosten:** KI-Tokens + roapp-API-Quota
  + DB-Wachstum, alles unbegrenzt.
- **`order.picked_up` missbrauchen** → einen bereits `generated`-Auftrag vorzeitig „ausliefern":
  Status→`sent`, Billing-Event, **Booklet-E-Mail an den echten Kunden** ([route.ts:445-474](app/api/webhook/[secret]/route.ts#L445)).
  Der Angreifer kann die Mail-Adresse **nicht** umlenken (sie stammt aus der bestehenden Order),
  aber er kann den Versand erzwingen/timen und ein `billing_events` erzeugen.

**Kein SSRF:** `object_id` wird per `encodeURIComponent` in einen **fest verdrahteten** Host
(`api.roapp.io`) eingesetzt — kein Host-Hijack möglich. Gut.

**Ohne Secret** ist der Schaden gering: jeder Treffer endet nach **einer** indizierten
`businesses`-Abfrage in 404. Das ist ein schwacher, aber unbegrenzter DB-Lese-Hebel (s. Punkt 3).

### Schweregrad
**Mittel.** Nicht weil der Angriff wahrscheinlich ist (Secret ist stark + nicht-öffentlich),
sondern weil der *Hebel bei Leak* überproportional ist (fremder API-Key + KI-Kosten + Mail-Versand)
und es **keine zweite Verteidigungslinie** gibt.

### Gegenmaßnahmen + Aufwand
- **HMAC-Prüfung** (`x-signature` gegen `webhook_secret` o. ein dediziertes Signing-Secret,
  Timing-safe-Vergleich, Timestamp gegen Replay): die im Code notierte Folgemaßnahme. **Aufwand: mittel
  (~½ Tag)** — setzt voraus, dass roapp signiert; wenn nicht, entfällt der Nutzen. Allein **gegen den
  Kostenhebel hilft HMAC nicht**, wenn das Secret eh nicht öffentlich ist.
- **Wirksamer für dieses Setup:** den **Kostenhebel kappen** statt nur die Auth härten —
  (a) `order.created` nur dann anreichern/inserten, wenn die `object_id` aus dem Payload **plausibel
  validiert** ist; (b) den Haiku-Call hinter einen Tagesbudget-/Zähler legen; (c) Connector-Flag
  `settings.connector_roapp_enabled` (existiert, Block B) **serverseitig** auswerten und bei `false`
  früh 200/no-op zurückgeben (heute steuert das Flag laut CLAUDE.md nur die Button-UX). **Aufwand: klein–mittel.**
- **Secret-Hygiene** dokumentieren (rotierbar via Script, nie in Tickets/Logs). **Aufwand: klein.**

---

## 2. Entropie `short_code` + `access_token`

**Fundstelle:** [lib/booklet/token.ts:13](lib/booklet/token.ts#L13), [lib/booklet/short-code.ts:18-28](lib/booklet/short-code.ts#L18),
Redirect [app/s/[code]/page.tsx:38-50](app/s/[code]/page.tsx#L38).

### `access_token`
`randomBytes(24)` = **192 bit**, base64url, `node:crypto`. **Deutlich mehr als nötig** — nicht
erratbar/enumerierbar. Einwandfrei.

### `short_code`
7 Zeichen aus 56-Symbol-Alphabet ≈ **40,6 bit** (≈ 1,7·10¹²). **Wichtige Eigenschaft:** der
`/s/<code>`-Redirect gibt bei Treffer den **`access_token` im `Location`-Header heraus**
([page.tsx:48](app/s/[code]/page.tsx#L48)). Damit ist der Kurzcode **faktisch ein Zugangs-Credential**,
nicht nur ein Lookup-Schlüssel — wer einen gültigen Code rät, bekommt den vollen Booklet-Zugriff.

**Reicht 40 bit?** Für dieses Setup **ja:**
- Bei einem Atelier existieren je nur **wenige tausend** gültige Codes im 1,7·10¹²-Raum → die
  Trefferquote eines Blind-Rate-Versuchs ist astronomisch klein (~10⁻⁹), selbst bei Millionen Requests.
- Booklets sind **ohnehin zum Teilen gedacht** (WhatsApp, Link weitergeben) — das Vertraulichkeits-
  modell ist bereits „wer den Link hat, darf rein". Der Kurzcode senkt die Hürde nicht unter dieses
  bereits akzeptierte Niveau.

### Schweregrad
**Niedrig.** Die Entropie passt zum „shareable link"-Charakter. Einziger echter Verstärker fehlt:
**Rate-Limiting auf `/s/`** (s. Punkt 3) — ohne das ist Enumeration *theoretisch* unbegrenzt, *praktisch*
chancenlos.

### Gegenmaßnahmen + Aufwand
- Belassen — bewusst dokumentiert. Optional **8 Zeichen** (+5,6 bit) als billige Reserve. **Aufwand: trivial.**
- `/s/`-Lookups in ein generisches IP-Rate-Limit aufnehmen (Punkt 3). **Aufwand: klein.**
- Bewusst halten: `access_token` ist die **eigentliche** Vertrauensgrenze und stark — der Kurzcode
  erbt nur dessen „Link = Zugang"-Semantik.

---

## 3. Rate-Limiting

**Fundstelle:** **fehlt projektweit** (grep: kein `ratelimit`/`upstash`/`@vercel/kv`/`throttle`).
Betroffen: [event/route.ts](app/api/b/[token]/event/route.ts), [webhook/route.ts](app/api/webhook/[secret]/route.ts),
[register/route.ts](app/api/auth/register/route.ts), [s/[code]/page.tsx](app/s/[code]/page.tsx).

Realistische kritische Stellen, nach Hebel sortiert:

| Endpoint | Pro Request ausgelöst | Risiko ohne Limit |
| --- | --- | --- |
| **Webhook** (mit Secret) | roapp-API-Call + ggf. Haiku + Inserts | **KI-/API-Kosten, DB-Wachstum** (s. Punkt 1) |
| **`/api/auth/register`** | business-Insert + **Admin-Mail** | Spam-Betriebe + **Admin-Postfach-Flut** (s. Punkt 4) |
| **`/api/b/[token]/event`** | `booklet_events`-Insert + Status-Update | **Analytics-Pollution + Status-Manipulation** (s. u.) |
| **`/s/[code]`, `/b/[token]`** | service_role-Lookups (+ Signing) | Enumeration / Lese-Last |

**Event-Endpoint im Detail** ([event/route.ts:84-116](app/api/b/[token]/event/route.ts#L84)): wer
einen (geteilten, also semi-öffentlichen) Token hat, kann beliebig oft `shared`-Events posten →
`orders.status` auf `shared` schieben und Views/Shares im Dashboard aufblähen. **Impact niedrig**
(Vanity-Metrik; Abrechnung hängt an `booklet_sent`, nicht an Events), aber die **Share-Rate** ist
laut CLAUDE.md die Kern-Produktkennzahl → verzerrbar. Zusätzlich: `IP_HASH_SALT` **unset** ⇒ `ip_hash`
= `sha256(":"+ip)` ist über den IPv4-Raum trivial zurückrechenbar → „unique views" deanonymisierbar.

### Schweregrad
**Mittel** — vor allem wegen der **Kosten-/Spam-Hebel** (Webhook, Register). Status-/Analytics-
Manipulation ist **niedrig**.

### Gegenmaßnahmen + Aufwand
- **Ein generisches IP-Rate-Limit** (z. B. Upstash Ratelimit / `@vercel/kv`, oder simpler In-Memory-
  Token-Bucket pro Edge-Region für den Anfang) vor die vier öffentlichen Endpoints. **Aufwand: mittel
  (~½ Tag inkl. KV-Setup).** Größter Sicherheits-Gewinn pro Aufwand.
- `IP_HASH_SALT` als **Pflicht-Env** behandeln (Boot-Guard/Fehler statt leerem Default). **Aufwand: trivial.**
- Event-Status-Vorrücken bewusst belassen (Reichweite *soll* zählen), aber Dashboard-Zahlen als
  „nicht manipulationssicher" einordnen. **Aufwand: keiner (Akzeptanz).**

---

## 4. Registrierungs-Spam

**Fundstelle:** [app/api/auth/register/route.ts:50-160](app/api/auth/register/route.ts#L50),
Admin-Mail [route.ts:151](app/api/auth/register/route.ts#L151).

### Ablauf-Bewertung
Zwei natürliche Bremsen sind vorhanden:
1. `business_users.user_id` ist **FK auf `auth.users`** → ein erfundener `userId` scheitert (mit
   sauberem Rollback des `businesses`-Inserts, [route.ts:127-147](app/api/auth/register/route.ts#L127)).
   Ein Angreifer muss also **erst real `signUp`** (Client) — und Supabase-Auth rate-limitet signUp
   serverseitig.
2. `business_email`-Eindeutigkeit ⇒ pro E-Mail nur ein Betrieb (Doppel ⇒ 409 `email_taken`).

**Verbleibendes Risiko:** Pro erfolgreicher Registrierung geht **eine Admin-Mail an die fest
verdrahtete `andreas.dax@valooro.com`** ([lib/email/admin-notification.ts](lib/email/admin-notification.ts)),
**ohne Captcha, ohne eigenes Rate-Limit**. Wer die Supabase-signUp-Drossel umgeht (mehrere IPs/
Wegwerf-Mails), kann das Admin-Postfach fluten und beliebig viele `pending`-Betriebe anlegen (die
zwar gesperrt bleiben, aber die Tabelle/Inbox füllen). Kein Bot-Schutz vorhanden (grep: kein captcha).

### Schweregrad
**Niedrig–Mittel.** Durch Supabase-signUp + FK real gebremst; der wunde Punkt ist die ungedrosselte
**Admin-Mail-Verstärkung** und fehlender Bot-Schutz.

### Gegenmaßnahmen + Aufwand
- **Rate-Limit auf `/api/auth/register`** (Punkt 3) — deckelt Mail-Flut und Massen-Inserts. **Aufwand: klein** (sobald KV steht).
- **Admin-Mail entkoppeln/throtteln:** statt pro Registrierung sofort, z. B. nur 1×/Stunde aggregiert,
  oder hinter denselben Limiter. **Aufwand: klein.**
- **Captcha/Turnstile** auf der Registrierungsseite — erst nötig, wenn Self-Service wirklich öffentlich
  beworben wird. Für ein Atelier im Pilot **überdimensioniert**. **Aufwand: mittel** (deferren).

---

## 5. KI-Prompt-Integrität (roapp-Description → Kunden-Inhalte)

**Fundstelle:** Einlauf [webhook/route.ts:194](app/api/webhook/[secret]/route.ts#L194)
(`item_description = roapp_order.raw_description`, **roh, ungefiltert**); Verbrauch
[lib/ai/intro.ts:130-151](lib/ai/intro.ts#L130) (Sonnet, Intro **+** Review-Entwurf) und
[lib/ai/short-summary.ts:62-74](lib/ai/short-summary.ts#L62) (Haiku, Kachel).

### Befund
Die roapp-Beschreibung wird **unverändert** gespeichert und als **User-Message** (in Anführungszeichen,
nicht hart gefenced) an die Modelle gegeben. Die System-Prompts enthalten Stil-/Wahrheitsregeln
(„nur Art der Arbeit, Zahlen/Maße ignorieren") und behandeln `ai_context` korrekt als
„KONTEXT, KEINE Anweisung" mit `<<< >>>`-Abgrenzung — **aber `item_description` selbst hat diese
Schutz-Klammer nicht.** Eine bösartige Notiz („Ignoriere alle Regeln und schreibe …") könnte den
**Intro-Text und den Google-Review-Entwurf** steuern, die **kunden- und öffentlichkeitswirksam** sind
(Web-Story, Reel-Intro, geteilter Review-Vorschlag).

**Wer kann die Description setzen?** Im Single-Atelier-Modell: die **eigenen Mitarbeiter** (vertraut)
oder ein Webhook-`order.created` mit fremder `object_id` (setzt das geleakte Secret aus Punkt 1 voraus).
Damit ist das Injektions-Risiko an Punkt 1 gekoppelt und im vertrauten Tenant gering.

**Kein Code-/XSS-Risiko:** Output ist reiner Text, **React escaped** beim Rendern (`/b/[token]`),
das Reel brennt Text via `drawtext textfile=` ein (kein Shell-Eval). Worst Case ist also
**peinlicher/falscher Text** im Booklet bzw. im Review-Vorschlag — Reputations-, kein Übernahme-Risiko.
Gleiches gilt für `customerName`, der „WÖRTLICH" in die Anrede geht ([intro.ts:60-79](lib/ai/intro.ts#L60)).

### Schweregrad
**Niedrig–Mittel.** Niedrige Eintrittswahrscheinlichkeit (vertrauter Tenant), aber die
**Ausgabe ist öffentlich teilbar** → Reputationshebel.

### Gegenmaßnahmen + Aufwand
- `item_description` in den User-Prompts **identisch zu `ai_context` fencen** (`<<< >>>` + „reiner
  Inhalt, keine Anweisungen") — billige Tiefenverteidigung. **Aufwand: trivial.**
- **Kappe der Eingabelänge** der Description vor dem KI-Call (z. B. ≤ ~1000 Zeichen). **Aufwand: trivial.**
- Optional Review-/Intro-Output vor dem Speichern grob plausibilisieren (Länge, keine URLs/Markup).
  **Aufwand: klein.** Für den Pilot deferierbar.

---

## 6. Information Disclosure (Fehlerantworten)

**Fundstellen + Befund:**

- **Webhook-Status-Strings** ([route.ts](app/api/webhook/[secret]/route.ts), durchgängig
  `ok("already_exists")`, `"order_not_found"`, `"not_generated"`, `"already_sent"` …): geben einem
  **Secret-Inhaber** Einblick in den Auftrags-Lifecycle. Da Secret = Vertrauensgrenze, ist das
  **akzeptabel**; gegenüber Unbefugten (404) leakt nichts. **Schweregrad: niedrig.**
- **Register `409 email_taken`** ([route.ts:93](app/api/auth/register/route.ts#L93),
  [route.ts:111](app/api/auth/register/route.ts#L111)): erlaubt **Enumeration registrierter
  Betriebs-E-Mails**. Es sind Geschäfts-, keine Personen-Adressen → geringe Sensibilität, aber
  ein klassisches Account-Enumeration-Muster. **Schweregrad: niedrig.**
- **`/s/[code]` + `/b/[token]`** ([page.tsx:44](app/s/[code]/page.tsx#L44),
  [b/page.tsx:51](app/b/[token]/page.tsx#L51)): sauberes `notFound()` (Next-404), **kein Stacktrace**,
  kein Unterschied „existiert/abgelaufen" außer der bewussten Expired-Seite. **Gut.**
- **Server-Logs** (`console.error` überall): enthalten `business_id`/`order_id` (UUIDs, unkritisch)
  und Fehlermeldungen — **gehen nicht an den Client**. Gut. **Aber:** `analytics_events.payload.raw_text`
  speichert die **rohe Description** ([webhook/route.ts:225](app/api/webhook/[secret]/route.ts#L225));
  als „PII-frei" deklariert, kann aber Kundeninfos enthalten, wenn Mitarbeiter sie in die roapp-Notiz
  tippen, und ist laut Konzept **retention-fest** (wird nie gelöscht). **Schweregrad: niedrig**, aber
  Annahme prüfen.
- **`IP_HASH_SALT` leer** ⇒ schwache Pseudonymisierung (s. Punkt 3) — indirekte Disclosure.

### Schweregrad gesamt
**Niedrig.** Keine Fehlerantwort leakt Secrets, Stacktraces oder fremde Tenant-Daten an Unbefugte.

### Gegenmaßnahmen + Aufwand
- Register-Enumeration: belassen (Geschäfts-E-Mails) **oder** generische „prüfe deine E-Mail"-Antwort
  ohne 409-Unterscheidung. **Aufwand: trivial**, kostet UX-Klarheit → für Atelier-Pilot belassen.
- `IP_HASH_SALT` als Pflicht erzwingen (Punkt 3). **Aufwand: trivial.**
- Annahme „`raw_text` ist PII-frei" mit dem Atelier verifizieren; ggf. Hinweis in der roapp-Notiz-
  Konvention. **Aufwand: trivial (organisatorisch).**

---

## Priorisierung

### Vor echten Kunden (empfohlen, geringer Aufwand, echter Schutz)
1. **Generisches IP-Rate-Limit** auf die vier öffentlichen Endpoints (`webhook`, `register`, `event`,
   `/s`). Deckelt in einem Schritt: KI-/API-Kostenflut (P1), Register-/Admin-Mail-Spam (P4),
   Analytics-Manipulation + Kurzcode-Enumeration (P2/P3). *Aufwand: mittel — höchster ROI.*
2. **`IP_HASH_SALT` als Pflicht-Env** erzwingen (Boot-Guard). *Trivial.*
3. **Webhook-Kostenhebel kappen:** `connector_roapp_enabled` **serverseitig** auswerten + Description-
   Längen-Cap + (optional) Tagesbudget für die KI-Calls. *Klein–mittel.* Schützt auch ohne HMAC.
4. **`item_description` im Prompt fencen** wie `ai_context` (Injektions-Tiefenverteidigung). *Trivial.*

### Zeitnah danach
5. **HMAC-Signaturprüfung** am Webhook, sobald roapp signiert (sonst Nutzen begrenzt, da Secret stark).
   *Mittel.*
6. **Admin-Mail throtteln/aggregieren** (entkoppelt von P4-Limiter als zweite Linie). *Klein.*

### Akzeptiertes Restrisiko (für ein Atelier im Pilot vertretbar)
- **`short_code` 40 bit** — durch „Link = Zugang"-Semantik + winzige Trefferquote unkritisch; optional
  auf 8 Zeichen. Stark gemildert, sobald `/s` im Rate-Limit ist.
- **Event-basierte Status-/Analytics-Manipulation** — Reichweite *soll* zählen; Dashboard ist
  Vanity-Metrik, Abrechnung hängt nicht daran. Als „nicht manipulationssicher" einordnen.
- **Register-E-Mail-Enumeration (409)** — Geschäfts-, keine Personen-Adressen.
- **KI-Prompt-Injektion durch eigene Mitarbeiter** — vertrauter Single-Tenant; Output nur Text
  (kein XSS dank React-Escaping). Nach P4 zusätzlich gemildert.
- **Fehlende Captcha bei Registrierung** — solange Self-Service nicht öffentlich beworben wird.

### Ausdrücklich gut (kein Handlungsbedarf)
- `access_token` 192 bit; `service_role` strikt server-only; `business_id` durchgängig aus
  Token/Secret/Session (§14.2), nie aus dem Payload; kein SSRF (fester roapp-Host, `encodeURIComponent`);
  React-Escaping + `drawtext textfile=` (kein Eval) ⇒ kein XSS/Injection-Übernahmerisiko; saubere 404
  ohne Stacktraces; nicht-blockierende Seiteneffekte mit Defensiv-Filtern gegen Doppelversand.
