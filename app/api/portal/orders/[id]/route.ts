import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { isEmailFormat } from "@/lib/settings/options";
import { websiteTextDraftForOrder } from "@/lib/ai/website-text";
import {
  isPositiveNumber,
  isValidWebsiteText,
  isWebsiteCategory,
  isWebsiteClothingType,
  normalizeWebsiteText,
  parseNumericInput,
} from "@/lib/orders/website";

/*
 * Seit dem Textentwurf (0018) kann dieser Handler einen Modell-Aufruf enthalten
 * (nur beim Umlegen ohne Text). Der Aufruf hat eine eigene Zeitgrenze von 30 s
 * (lib/ai/website-text.ts); `maxDuration` liegt darüber, damit eine
 * Zeitüberschreitung als klarer Fehlercode ankommt statt als abgeschnittene
 * Funktion. Der Kontakt-Pfad bleibt davon unberührt und antwortet wie bisher
 * sofort.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/** Trimmt einen String; leerer/Nicht-String-Wert → null (Feld entfernen erlaubt). */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Der Website-Block: die Spalten aus 0015 + `website_text` (0017) + die
 * Einwilligung (`consent_given`, Spalte aus 0001) — zusammen bewertet, siehe
 * unten.
 *
 * ⚠️ `consent_given` ist bewusst KEINE `website_*`-Spalte: Die Einwilligung ist
 *    ein eigenständiger, rechtlich getragener Sachverhalt (unterschriebenes
 *    Formular an der Kassa) und existierte lange vor der Website-Anbindung. Sie
 *    wird hier nur MIT bewertet, weil sie Voraussetzung fürs Veröffentlichen
 *    ist.
 *
 *    ⚠️ Die Oberfläche schickt sie NICHT mehr mit: Seit der Umstellung wird die
 *       Einwilligung schon bei der Auftragsanlage gesetzt (Webhook wie
 *       manueller Weg), der Schalter auf der Detailseite ist entfallen. Der Key
 *       bleibt hier trotzdem gültig — er ist der einzige Weg, sie ohne
 *       SQL-Eingriff nachzutragen (Aufträge von VOR der Umstellung).
 */
const WEBSITE_KEYS = [
  "website_visible",
  "website_category",
  "website_clothing_type",
  "website_work_hours",
  "website_price",
  "website_text",
  "consent_given",
] as const;

/**
 * PATCH /api/portal/orders/[id] — aktualisiert Kundenkontaktdaten
 * (`customer_email`/`customer_phone`) und/oder die Website-Veröffentlichung
 * (`website_*`, Migration 0015) eines Auftrags.
 *
 * Body: alle Felder optional; nur die im Body enthaltenen werden geschrieben.
 * Kontakt: leer ⇒ `null` (Entfernen erlaubt), E-Mail-Format geprüft (sonst 400
 * `invalid_email`); Telefon ist Freitext — KEINE Normalisierung (passiert erst
 * beim SMS-Versand).
 *
 * ── Website-Veröffentlichung: ein ZUSAMMENGEHÖRIGER Block ──────────────────
 * Sobald IRGENDEIN `website_*`-Key im Body steht, wird der Block als Einheit
 * bewertet — die fünf Angaben sind genau dann Pflicht, wenn der Auftrag danach
 * sichtbar ist. Das gilt auch für spätere Korrekturen (z. B. Preis ändern),
 * damit ein sichtbarer Auftrag nie mit halben Angaben dasteht.
 *
 * Die fünfte Angabe ist `website_text` („Was wurde gemacht", 0017) — der Text
 * fürs öffentliche Archiv, Pflicht ab 80 Zeichen.
 *
 * ⚠️ TEXTENTWURF (0018): Ist beim Umlegen KEIN Text da, wird einer erzeugt
 *    (Haiku, aus den Bildunterschriften + der Annahmenotiz) und mitgespeichert;
 *    er läuft danach durch dieselbe 80-Zeichen-Prüfung wie ein getippter Text.
 *    Scheitert die Erzeugung, scheitert das Umlegen (502
 *    `text_generation_failed`) — es wird KEIN leerer Text gespeichert.
 *
 *    Der Regelfall ist das allerdings nicht: Die Oberfläche erzeugt den Entwurf
 *    schon beim Klick auf den Schalter (`POST …/website-text`), damit ihn
 *    jemand ansehen kann. Hier greift die Erzeugung nur, wenn das nicht
 *    stattgefunden hat — etwa bei einem Aufruf ohne Oberfläche.
 *
 *    Das Kennzeichen `website_text_ki_entwurf` wird ABGELEITET, nie übernommen:
 *    `true` beim Erzeugen; `false`, sobald der übergebene Text vom gespeicherten
 *    abweicht (= von Hand bearbeitet). Ein Speichern ohne Textänderung lässt es
 *    stehen — es beantwortet „hat jemand den Text angefasst?“, nicht „hat jemand
 *    gespeichert?“.
 *
 * ⚠️ EINWILLIGUNG (`consent_given`, Spalte aus 0001) ist Voraussetzung fürs
 *    Veröffentlichen: `website_visible = true` ohne bestätigte Einwilligung ⇒
 *    400 `consent_required`. Das ist seit der automatischen Einwilligung bei der
 *    Anlage nur noch ein STILLER SCHUTZ — neue Aufträge tragen sie ohnehin; er
 *    greift bei Aufträgen von VOR der Umstellung. Die Einwilligung selbst hat
 *    KEIN eigenes Sperrverhalten (änderbar wie die übrigen Angaben) — solange
 *    der Auftrag aber sichtbar ist, greift dieselbe Prüfung auch beim
 *    Zurücknehmen, sonst stünde ein veröffentlichtes Stück ohne sie da.
 *    `consent_at` wird beim Setzen automatisch gestempelt und beim Zurücknehmen
 *    geleert; ein bereits vorhandener Zeitstempel wird NICHT überschrieben (er
 *    hält fest, wann die Einwilligung erfasst wurde, nicht wann zuletzt
 *    gespeichert wurde).
 *
 * ⚠️ EINBAHNSTRASSE: Ein bereits gespeichertes `website_visible = true` kann
 *    über diese Route NICHT auf false zurückgesetzt werden (400
 *    `website_locked`). Die VIER WERTE bleiben dabei ausdrücklich EDITIERBAR —
 *    gesperrt ist nur der Schalter selbst. Korrektur eines versehentlich
 *    veröffentlichten Auftrags ist bewusst ein SQL-Eingriff, kein Klick.
 *
 * ⚠️ REINE ERFASSUNG: kein API-Call, kein Webhook, kein Medien-Versand an eine
 *    externe Stelle. Die Werte landen ausschließlich in Handwerks eigener DB.
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). 401/403 ohne
 * User/Betrieb. Die Order wird über RLS geladen — fremde/fehlende id ⇒ 404. Das
 * Update ist defensiv auf `id` + `business_id` gefiltert.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const business = await getCurrentBusiness();
  if (!business) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Order über RLS laden — fremde/fehlende id ⇒ 404. business_id kommt von hier.
  // `website_visible` wird mitgeladen, weil die Sperre gegen den GESPEICHERTEN
  // Zustand prüft (nicht gegen einen Client-Wert); `consent_given`/`consent_at`
  // ebenso — der Zeitstempel darf nur beim erstmaligen Setzen entstehen.
  // `website_text`/`website_text_ki_entwurf` tragen die Entwurfs-Logik (0018):
  // der gespeicherte Text entscheidet, ob erzeugt werden muss und ob das
  // Kennzeichen stehen bleibt. `item_description`/`language` sind das Material
  // für die Erzeugung.
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, business_id, item_description, language, website_visible, website_text, website_text_ki_entwurf, consent_given, consent_at",
    )
    .eq("id", orderId)
    .maybeSingle<{
      id: string;
      business_id: string;
      item_description: string | null;
      language: string;
      website_visible: boolean;
      website_text: string | null;
      website_text_ki_entwurf: boolean;
      consent_given: boolean;
      consent_at: string | null;
    }>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;

  // Nur die im Body enthaltenen Felder werden aktualisiert (partielles PATCH).
  const updates: {
    customer_email?: string | null;
    customer_phone?: string | null;
    website_visible?: boolean;
    website_category?: string;
    website_clothing_type?: string;
    website_work_hours?: number;
    website_price?: number;
    website_text?: string;
    website_text_ki_entwurf?: boolean;
    consent_given?: boolean;
    consent_at?: string | null;
  } = {};

  if ("customer_email" in payload) {
    const email = trimmedOrNull(payload.customer_email);
    // leer ⇒ null (entfernen); gesetzt ⇒ Format prüfen.
    if (email !== null && !isEmailFormat(email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
    updates.customer_email = email;
  }

  if ("customer_phone" in payload) {
    // Freitext: leer ⇒ null (entfernen), sonst unverändert speichern — KEINE
    // Normalisierung (erst beim SMS-Versand).
    updates.customer_phone = trimmedOrNull(payload.customer_phone);
  }

  // ── Website-Veröffentlichung (0015) — als EINE Einheit bewertet ──────────
  // Ausgelöst, sobald irgendein website_*-Key im Body steht. So bleibt „die
  // vier Angaben sind Pflicht, solange sichtbar" auch bei reinen Korrekturen
  // (ohne mitgeschicktes website_visible) erzwungen.
  if (WEBSITE_KEYS.some((key) => key in payload)) {
    // Zielzustand: explizit im Body, sonst der gespeicherte Zustand.
    const nextVisible =
      "website_visible" in payload
        ? payload.website_visible === true
        : order.website_visible;

    // EINBAHNSTRASSE: ein gespeichertes true lässt sich hier nicht abschalten.
    // Geprüft wird der DB-Zustand, nicht der Client-Wunsch.
    if (order.website_visible && !nextVisible) {
      return NextResponse.json({ error: "website_locked" }, { status: 400 });
    }

    // Einwilligung — Zielzustand wie oben: explizit im Body, sonst gespeichert.
    const nextConsent =
      "consent_given" in payload
        ? payload.consent_given === true
        : order.consent_given;

    // OHNE bestätigte Einwilligung KEIN Veröffentlichen. Greift auch, wenn ein
    // bereits sichtbarer Auftrag die Einwilligung zurücknehmen wollte — dann
    // stünde ein veröffentlichtes Stück ohne sie da.
    if (nextVisible && !nextConsent) {
      return NextResponse.json({ error: "consent_required" }, { status: 400 });
    }

    if ("consent_given" in payload) {
      updates.consent_given = nextConsent;
      if (!nextConsent) {
        // Zurückgenommen ⇒ Zeitstempel mit weg (wie beim manuellen Anlegen).
        updates.consent_at = null;
      } else if (!order.consent_at) {
        // Erstmals gesetzt ⇒ jetzt stempeln. Ein vorhandener Zeitstempel bleibt
        // stehen: er hält fest, wann die Einwilligung erfasst wurde.
        updates.consent_at = new Date().toISOString();
      }
    }

    if (nextVisible) {
      // Sichtbar ⇒ alle fünf Angaben Pflicht und gültig.
      const category = payload.website_category;
      if (!isWebsiteCategory(category)) {
        return NextResponse.json(
          { error: "invalid_website_category" },
          { status: 400 },
        );
      }

      const clothingType = payload.website_clothing_type;
      if (!isWebsiteClothingType(clothingType)) {
        return NextResponse.json(
          { error: "invalid_website_clothing_type" },
          { status: 400 },
        );
      }

      // Zahlenfelder: Komma-Dezimaltrenner erlaubt; leer/ungültig ⇒ null ⇒ 400.
      const workHours = parseNumericInput(payload.website_work_hours);
      if (!isPositiveNumber(workHours)) {
        return NextResponse.json(
          { error: "invalid_website_work_hours" },
          { status: 400 },
        );
      }

      const price = parseNumericInput(payload.website_price);
      if (!isPositiveNumber(price)) {
        return NextResponse.json(
          { error: "invalid_website_price" },
          { status: 400 },
        );
      }

      /* „Was wurde gemacht" (0017): Pflicht ab 80 Zeichen getrimmt. Der erste
         Satz wird drüben zur Bildunterschrift — deshalb die Untergrenze, nicht
         bloß „nicht leer". Begründung im Kopf von lib/orders/website.ts.

         Erst wird bestimmt, welcher Text überhaupt gemeint ist: der aus dem
         Body, wenn einer mitkam — sonst der gespeicherte. Ein PATCH, das nur
         den Preis korrigiert und `website_text` gar nicht mitschickt, darf
         weder eine Erzeugung auslösen noch den vorhandenen Text verlieren. */
      const textImBody = "website_text" in payload;
      const vorhandenerText = textImBody
        ? payload.website_text
        : order.website_text;
      const hatText =
        typeof vorhandenerText === "string" &&
        vorhandenerText.trim().length > 0;

      /* Kein Text ⇒ einen erzeugen (0018). Steht bewusst NACH den vier
         Angaben oben und nach der Einwilligung: Ein unvollständiges Formular
         soll keinen Modell-Aufruf kosten. Und vor der 80-Zeichen-Prüfung, denn
         der Entwurf muss durch dieselbe Prüfung wie ein getippter Text. */
      let websiteText: unknown = vorhandenerText;
      let erzeugt = false;
      if (!hatText) {
        try {
          websiteText = await websiteTextDraftForOrder(supabase, order);
          erzeugt = true;
        } catch (err) {
          console.error(
            `[order PATCH] text_generation_failed (order ${orderId}):`,
            err,
          );
          /* 502 und nicht 500: Gescheitert ist der Aufruf beim Modell-Anbieter,
             nicht etwas bei uns. Das Umlegen scheitert damit vollständig —
             gespeichert wird NICHTS, insbesondere kein leerer Text. */
          return NextResponse.json(
            { error: "text_generation_failed" },
            { status: 502 },
          );
        }
      }

      if (!isValidWebsiteText(websiteText)) {
        return NextResponse.json(
          { error: "invalid_website_text" },
          { status: 400 },
        );
      }

      updates.website_visible = true;
      updates.website_category = category;
      updates.website_clothing_type = clothingType;
      updates.website_work_hours = workHours;
      updates.website_price = price;
      // Getrimmt speichern: genau diese Fassung wurde geprüft.
      updates.website_text = normalizeWebsiteText(websiteText);

      /* Kennzeichen „unbearbeiteter KI-Entwurf" (0018) — ABGELEITET, nie aus
         dem Body übernommen. Drei Fälle:
           · gerade erzeugt              ⇒ true.
           · Text kam mit dem Body       ⇒ true nur, wenn er BUCHSTÄBLICH dem
                                           gespeicherten Entwurf entspricht;
                                           jede Änderung ⇒ false.
           · Text kam nicht mit          ⇒ gar nicht anfassen (niemand hat ihn
                                           angesehen, also ändert sich nichts). */
      if (erzeugt) {
        updates.website_text_ki_entwurf = true;
      } else if (textImBody) {
        updates.website_text_ki_entwurf =
          order.website_text_ki_entwurf &&
          updates.website_text === order.website_text;
      }
    } else {
      // Nicht sichtbar (war es auch vorher nicht — sonst hätte die Sperre oben
      // gegriffen): nur das Flag schreiben. Etwaige Altwerte in den fünf
      // Spalten bleiben unangetastet; sie sind unsichtbar und bedeutungslos,
      // solange website_visible = false.
      updates.website_visible = false;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", order.id)
    .eq("business_id", order.business_id)
    .select(
      "customer_email, customer_phone, website_visible, website_category, website_clothing_type, website_work_hours, website_price, website_text, website_text_ki_entwurf, consent_given, consent_at",
    )
    .single<{
      customer_email: string | null;
      customer_phone: string | null;
      website_visible: boolean;
      website_category: string | null;
      website_clothing_type: string | null;
      website_work_hours: number | null;
      website_price: number | null;
      website_text: string | null;
      website_text_ki_entwurf: boolean;
      consent_given: boolean;
      consent_at: string | null;
    }>();

  if (error || !data) {
    console.error(`[order PATCH] update_failed (order ${orderId}):`, error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}
