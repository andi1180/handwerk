# Konsistenz- & Sicherheits-Review (vor E2E-Test)

Datum: 2026-06-12 · Branch: `main` · Scope: alle Route-Handler, lib-DB-Zugriffe,
Migrationen 0001–0009, Webhook-Pfad, Status-Maschine, UI-Dead-Ends.
**Es wurde NICHTS geändert — reiner Befund.**

Methodik: alle 19 Route-Handler unter `app/api/**`, die öffentlichen Seiten
`/b/[token]` + `/s/[code]`, `middleware.ts`, `lib/auth/current-business.ts`,
`lib/supabase/service.ts`, `lib/booklet/*`, `lib/roapp/*` sowie alle Migrationen
+ Verify-Gates gelesen. Querbezüge zu CLAUDE.md / TECH.md (Soll-Zustand).

**Gesamtbild: solide.** Die Mandanten-Isolation ist durchgängig korrekt
umgesetzt; `service_role` wird diszipliniert und nur dort verwendet, wo nötig.
Es gibt **eine** mittelschwere Konsistenzlücke (Doppelversand-Schutz im manuellen
Deliver-Pfad fehlt), die vor dem E2E-Test geschlossen werden sollte, plus einige
niedrigschwellige Hinweise.

---

## 1. Mandanten-Isolation — **OK** (1 Hinweis niedrig)

Geprüft: jede Query/Mutation mit `business_id`. Die Regel „`business_id` kommt aus
Session (`getCurrentBusiness`) oder aus dem `webhook_secret`-Lookup, NIE aus dem
Body" ist **ausnahmslos** eingehalten.

Belegliste (wo `business_id` gesetzt/gescoped wird → Quelle):

| Stelle | Quelle der business_id |
|---|---|
| `orders/route.ts:72` (Insert) | `business.id` aus `getCurrentBusiness` ✓ |
| `orders/[id]/generate/route.ts:222` (booklets Insert, service_role) | `order.business_id` aus RLS-geladener Order ✓ |
| `orders/[id]/deliver/route.ts:149` (billing Insert, service_role) | `order.business_id` aus RLS-geladener Order ✓ |
| `orders/[id]/media/route.ts:155` (Insert) | `order.business_id` aus RLS-geladener Order; Body-`storage_path` muss `${business_id}/${order_id}/` matchen ✓ |
| `orders/[id]/render-reel/route.ts` (Storage/booklets, service_role) | `order.business_id` aus RLS-geladener Order ✓ |
| `b/[token]/event/route.ts:69` (booklet_events, service_role) | `booklet.business_id` aus Token-Lookup ✓ |
| `auth/register/route.ts:123/137` (service_role) | `inserted.id` des frisch angelegten Betriebs ✓ |
| `webhook/[secret]/route.ts` (alle ~18 Stellen) | `business.id` aus `webhook_secret`-Lookup, NIE Payload ✓ |
| `settings/route.ts`, `settings/logo`, `settings/background` | `business.id` aus `getCurrentBusiness`; Body-Pfad gegen `${business.id}/…` validiert ✓ |
| `lib/booklet/load.ts` (öffentlicher Render, service_role) | `booklet.business_id` aus Token-Lookup; alle Folge-Reads strikt darauf gescoped ✓ |

- Alle `/api/portal/*`-Routen laufen über den AUTHENTICATED Server-Client, RLS
  erzwingt zusätzlich die Mitgliedschaft (Policies aus 0001). `getCurrentBusiness`
  selbst nutzt **kein** service_role.
- `media/[mediaId]/route.ts:37-42`, `media/reorder`, `captions` etc. laden die
  Order/Medien über RLS **und** prüfen defensiv `order_id` — kein Cross-Tenant-Leak.
- Öffentliche Reads (`/b/[token]`, `/s/[code]`, `/api/b/[token]/event`) leiten
  alles aus dem `access_token`/`short_code`-Lookup ab — der Token ist die einzige
  Vertrauensquelle (§14.2).

**Keine Abweichung gefunden.**

**Hinweis (niedrig) — kein Isolationsbruch, nur Vollständigkeit:** Die
Webhook-Updates in `handleOrderPickedUp` (Status `generated→sent`, Z. 394-398)
scopen nur auf `.eq("id", order.id).eq("status","generated")`, ohne zusätzliches
`.eq("business_id", …)`. Das ist **korrekt** (`order.id` wurde zuvor
business-gescoped geladen und ist PK-unique), aber asymmetrisch zu den übrigen
service_role-Writes, die das `business_id`-Scope mitführen. Reine Defense-in-Depth,
kein Fehler.

---

## 2. service_role-Gebrauch — **OK**

Alle `createServiceClient()`-Aufrufe und ihre Rechtfertigung:

| Datei | Nötig? | Begründung |
|---|---|---|
| `lib/supabase/service.ts` | — | Factory |
| `webhook/[secret]/route.ts` | **Ja** | Kein Session-Kontext (Pfad-Secret-Auth); zudem `billing_events`/`analytics_events` haben kein `authenticated`-INSERT-Grant ✓ |
| `auth/register/route.ts` | **Ja** | Öffentlich, noch keine Session; legt fremde/neue `business_id` an ✓ |
| `b/[token]/event/route.ts` | **Ja** | Öffentlich (Kunde, anon); `booklet_events` kein `authenticated`-INSERT-Grant ✓ |
| `lib/booklet/load.ts` | **Ja** | Öffentlicher Render, anon — kein anon-SELECT-Grant, Token-validiert ✓ |
| `s/[code]/page.tsx` | **Ja** | Öffentlicher Redirect, anon ✓ |
| `lib/reel/ffmpeg.ts` | **Ja** | Lädt ffmpeg-Binary aus Bucket `assets` (nur service_role lesbar) ✓ |
| `orders/[id]/generate/route.ts` | **Ja** | `booklets`-INSERT/UPDATE — 0001 lässt für `authenticated` nur SELECT/UPDATE zu, **Insert** braucht service_role ✓ |
| `orders/[id]/deliver/route.ts` | **Teilweise** | Nur der `billing_events`-Insert (kein `authenticated`-INSERT-Grant). Status-/`sent_at`-Updates laufen bewusst über AUTHENTICATED ✓ |
| `orders/[id]/render-reel/route.ts` | **Ja** | Hintergrund-`after()`-Job (Session-Cookies im Hintergrund nicht zuverlässig) + Storage-Writes + `booklets.reel_status` ✓ |

**Keine unnötige RLS-Umgehung.** Wo Session vorhanden ist, wird konsequent der
AUTHENTICATED Client genutzt (Status-Updates, `sent_at`, reel-status-Poll-Signing
in `reel-status/route.ts:60` über den AUTHENTICATED Storage-Client statt
service_role — vorbildlich).

---

## 3. Status-Maschine — **1 Befund mittel, sonst OK**

`ORDER_STATUSES` (= 0001-Check): `draft, finalized, generated, sent, viewed, shared`.

Übergänge im Code:

| Von → Nach | Auslöser | Schutz |
|---|---|---|
| (Insert) → `draft` | `orders/route.ts`, Webhook `created` | — |
| `draft → finalized` | `finalize/route.ts:67` | `.eq("status","draft")` + `need_media` ✓ |
| `finalized → draft` | `reopen/route.ts` | `.eq("status", order.status)` ✓ |
| `finalized → generated` | `generate/route.ts:262` | `.eq("status", order.status)` ✓ |
| `generated → draft` | `reopen/route.ts` | ✓ |
| `generated → generated` | `generate` (Re-Generate) | No-op-Treffer ✓ |
| `generated → sent` | `deliver/route.ts:114`, Webhook `picked_up` | siehe Befund 3.1 |
| `sent → viewed` | `b/[token]/event:86` | `.eq("status","sent")` monoton ✓ |
| `sent\|viewed → shared` | `b/[token]/event:102` | `.in("status",["sent","viewed"])` monoton ✓ |

- **Keine unerreichbaren Status**, alle sechs sind erreichbar.
- **`shared` ist terminal** — gewollt (Erfolgs-Endzustand). `sent`/`viewed`/`shared`
  lassen sich nicht reopenen (gewollt: einmal versendet, nicht zurückdrehbar).
- `picked_up_at`-Flag (0009) ist eine **orthogonale** Achse, kein Status — wird in
  Deliver (`:116`) und Webhook (`:396`) beim `→sent` auf `null` zurückgesetzt; in
  `handlePickedUp` nur bei `draft`/`finalized` gesetzt. Konsistent.

### 3.1 — **mittel:** Deliver-Pfad ohne `count`-Doppelversand-Schutz

`app/api/portal/orders/[id]/deliver/route.ts:114-126` aktualisiert
`generated → sent` mit `.eq("status","generated")`, prüft danach aber **nicht**,
ob tatsächlich eine Zeile getroffen wurde. Bei Doppelklick/Race lesen zwei
Requests `status='generated'` (vor dem ersten Write), beide passieren den Guard
(`:86`), der erste setzt `sent`, der **zweite** trifft 0 Zeilen — `statusError`
bleibt `null`, und der Handler läuft weiter zu:
- **zweitem `billing_events`-Insert** (`:148`, Abrechnung doppelt gezählt), und
- **zweiter Booklet-E-Mail an den Kunden** (`:177`).

Der Webhook-Pfad macht das **richtig**: `handleOrderPickedUp` prüft
`if (!count) return ok("already_sent")` (`:408`) und überspringt alle
Nebenwirkungen. Der manuelle Pfad ist hier inkonsistent.

Fix-Skizze: Update mit `{ count: "exact" }` ausführen und bei `count === 0` mit
`{ sent: true, alreadySent: true }` (o. ä.) zurückkehren, **bevor** Billing/E-Mail
laufen — exakt wie im Webhook.

**Schweregrad mittel** (Abrechnungs-Integrität + doppelte Kunden-E-Mail).

---

## 4. Nicht-blockierende Pfade — **OK** (1 Hinweis niedrig)

Alle „loggen statt abbrechen"-Stellen verschlucken nur **bewusst unkritische**
Fehler und sind mit `console.error` + Kontext (`order_id`/`business_id`/`step`/
`message`) versehen:

- Webhook: `analytics_insert`, `short_summary_*`, `sent_at_update`,
  `billing_insert`, `email`, `pickup_flag`, `secret_lookup`, `created_lookup`,
  `pickedup_lookup` — **alle geloggt** ✓
- Deliver: `sent_at_update`, `billing_insert`, `email` — geloggt; `emailFailed`
  wird sogar bis ins UI durchgereicht (einmaliger `window.alert`) ✓
- `orders/route.ts` short_summary — geloggt ✓
- `register/route.ts` admin-email + rollback — geloggt ✓
- `b/[token]/event/route.ts`: Event-Insert + Lifecycle-Advance geloggt ✓

Keiner dieser Pfade verschluckt einen Fehler, der eigentlich den Nutzer blocken
müsste — die kritischen Pfade (Order-Insert, Status-Übergang, Intro-Generierung)
brechen korrekt mit 4xx/5xx ab.

**Hinweis (niedrig):** In `b/[token]/event/route.ts:93-99` und `:109-115` werden
die `booklets.viewed_at` / `first_shared_at`-Updates **ohne** Fehler-Capture
ausgeführt (kein `const { error }`). Reine Best-Effort-Zeitstempel, der eigentliche
Event-Row wird zuvor geschrieben — kosmetisch, kein Datenverlust. Optional
angleichen.

---

## 5. Migration-vs-Code-Drift — **OK** (nur dokumentierte Forward-Compat-Artefakte)

Jede vom Code gelesene/geschriebene Spalte existiert in 0001–0009:

- `orders`: alle Felder aus 0001 + `short_summary` (0007) + `picked_up_at` (0009) ✓
- `booklets`: 0001 + `reel_status`/`reel_error` (0004) + `short_code` (0008) ✓
- `businesses`: 0001; `status='pending'` per 0005 in den Check aufgenommen ✓
- `analytics_events` (0006): `event_type`/`source`/`external_ref`/`payload` ✓
- `booklet_events`: Code emittiert nur `viewed`/`shared`/`link_click` +
  `channel`-Werte → liegt im 0001-Check (`qr_click` ungenutzt, s. u.) ✓
- `billing_events`: Code schreibt nur `event_type='booklet_sent'` = einziger
  erlaubter Wert ✓

**Ungenutzte Migrations-Artefakte (alle dokumentiert / Forward-Compat, niedrig):**
- `businesses.consent_text`, `businesses.stripe_customer_id` — kein Code-Pfad.
- `booklets.image_urls`, `booklets.expires_at` — `expires_at` wird in
  `load.ts:139` **gelesen** (Ablauf-Check), aber nirgends **geschrieben** → der
  Ablauf-Zweig ist aktuell toter Code (forward-compat, im Kommentar vermerkt).
- `order_media.tag` — bewusst behalten (6b.2), UI entfernt.
- `booklet_events.event_type='qr_click'` — im Check erlaubt, nie emittiert.

Keine harte Diskrepanz (kein Code referenziert eine fehlende Spalte/Policy/Tabelle).

**Wichtig für E2E:** Die Migrationen **0006, 0007, 0008, 0009 müssen vorher manuell
im Supabase-SQL-Editor angewendet sein** (CLAUDE.md weist mehrfach darauf hin).
Fehlt z. B. 0009, scheitert das `picked_up_at`-Update im Webhook (non-fatal,
geloggt) und der Warn-Badge erscheint nie; fehlt 0007/0008, brechen
`short_summary`-/`short_code`-Schreibpfade (teils non-fatal, der short_code-Insert
in `generate` jedoch **fatal** → 500 `upsert_failed`).

---

## 6. Webhook-Robustheit — **OK**

`POST /api/webhook/[secret]` — Retry-Sturm-Analyse:

- **Einziges hartes Gate:** ungültiges/fehlendes Secret ⇒ 404 (`notFound()`).
- **Alle** anderen Pfade antworten 200 + Status-String (`ok(...)`): `lookup_failed`,
  `bad_body`, `ignored_event`, `no_object_id`, `enrich_failed`, `already_exists`,
  `insert_failed`, `noop_status`, `order_not_found`, `already_delivered_noop`,
  `flagged_pickup_pending`, `no_booklet`, `status_failed`, `already_sent`,
  `created`, `sent`, `sent_no_email`. Jeder Früh-Return ist benannt.
- Throw-Risiken sind **alle** gekapselt:
  - `request.json()` → try/catch ⇒ `bad_body` ✓
  - `getRoappOrder()` → try/catch ⇒ `enrich_failed` ✓
  - `generateShortSummary()` → try/catch ✓
  - `sendBookletEmail()` → try/catch ✓
  - `parseWebhookBody()` / `classifyEvent()` (`lib/roapp/events.ts`) sind **rein
    defensiv** (kein throw bei Malformed-Input) — verifiziert ✓
  - `normalizeSettings()` / `bookletShareLink()` / `bookletBaseUrl()` sind pure
    Funktionen ohne throw ✓

Kein Pfad, der zu einem unbehandelten 500 führt. (Einzige theoretische 500-Quelle:
`createServiceClient()` bei fehlenden Env-Vars — Deployment-Fehlkonfiguration,
nicht event-spezifisch.)

---

## 7. Dead Ends / UX-Traps — **OK** (2 Hinweise)

- Alle Buttons/Links, die ich gegengeprüft habe, führen auf existierende Routen
  (`generate`/`deliver`/`finalize`/`reopen`/`render-reel`/`reel-status`/`qr`,
  Vorschau-Links `/b/[token]?c=1&p=1`, Kurzlinks `/s/[code]`).
- Status-getriebene UI hat überall einen Ausweg: `draft`↔`finalized`↔`generated`
  via Finalize/Reopen/Generate; `sent`+ ist read-only (gewollt).
- `redirect('/portal')` auf der Root, `/pending`/`/register` außerhalb `/portal`
  (keine Middleware-Schleife) — sauber.

**Hinweis 7.1 (niedrig/mittel, UX):** Ein Reel lässt sich nur im Status
`generated` rendern (`render-reel:135` → 409 sonst). Liefert ein Betrieb **vor**
dem Reel-Render aus (der Deliver-Button warnt nur, blockt nicht), wechselt der
Status auf `sent` und ist **nicht mehr reopenbar** → das Reel bleibt dauerhaft
un-renderbar, der Kunde bekommt nie eines. Bewusst gewählte, gewarnte Aktion,
aber eine Sackgasse ohne Reparaturweg. Für E2E nur beobachten.

**Hinweis 7.2 (niedrig):** `businesses.status='suspended'` (0001/0005-Check
erlaubt) hat **keinen** Code-Pfad: weder `middleware.ts` noch
`getCurrentBusiness` behandeln `suspended` (nur `pending` leitet auf `/pending`
um). Ein in der DB suspendierter Betrieb behält vollen Portal-Zugang. Aktuell
kein Suspend-UI, daher latent — vor einem echten Suspend-Feature schließen.

---

## Priorisierung

### MUSS vor dem E2E-Test
1. **Befund 3.1 (mittel)** — Deliver-Pfad um den `count`-Doppelversand-Schutz
   ergänzen (analog Webhook). Sonst riskiert ein Doppelklick auf „Ausliefern"
   doppelte Billing-Events **und** zwei Kunden-E-Mails. Kleiner, lokaler Fix.
2. **Migrationen 0006–0009 anwenden** (Punkt 5) — sicherstellen, dass alle im
   Supabase-Dashboard eingespielt sind, sonst scheitern Schreibpfade (0008
   short_code sogar **fatal** im `generate`). Kein Code-Fix, aber Vorbedingung.

### KANN warten (nach E2E / vor Skalierung)
3. **Single-Tenant `ROAPP_API_KEY`** (bekannt, CLAUDE.md/TECH.md): global statt
   pro Betrieb. Solange nur Atelier Dax den Connector nutzt, unkritisch — **vor
   Onboarding eines zweiten roapp-Betriebs** zwingend auf eine pro-Betrieb-Spalte
   umstellen (sonst Anreicherung mit fremdem Account).
4. **Webhook-HMAC (`x-signature`)** ungeprüft — Pfad-Secret ist die MVP-Auth
   (dokumentiert). Folgeschritt.
5. **Hinweis 7.1** — Reel nach Versand un-renderbar: Reparaturweg überlegen
   (z. B. Reel-Render auch im Status `sent` erlauben).
6. **Hinweis 7.2** — `suspended`-Status verdrahten, bevor es ein Suspend-Feature
   gibt.
7. **Hinweis 4** — `viewed_at`/`first_shared_at`-Updates mit Fehler-Log angleichen
   (kosmetisch).

### Bestätigt sauber (keine Aktion)
Mandanten-Isolation (1), service_role-Disziplin (2), Status-Erreichbarkeit (3
außer 3.1), Logging der non-blocking-Pfade (4), Webhook-Retry-Sicherheit (6),
UI-Routing (7).
