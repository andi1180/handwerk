/**
 * scripts/import-roapp-orders.ts — EINMALIGER Backfill, lokal ausgeführt.
 *
 * Legt für eine FEST vorgegebene Liste interner roapp-Order-IDs (`OBJECT_IDS`)
 * je einen Auftrag im Betrieb `BUSINESS_EMAIL` als `status='draft'` an. Holt pro
 * ID die Order über die roapp-API (EIN Call, identisch zum Webhook-Connector
 * §12), repliziert die Anlage-Felder des Webhooks (ohne ihn zu importieren) und
 * generiert — wie bei der Live-Anlage — die KI-Kurzbeschreibung (Haiku).
 *
 * HARTE GRENZEN (bewusst, NICHT erweitern):
 *  - Importmenge = GENAU `OBJECT_IDS`. KEIN Listen-/Such-Endpoint, KEIN
 *    Auto-Discovery. Die IDs liest der Nutzer aus den roapp-Web-UI-URLs ab.
 *  - Das Script legt AUSSCHLIESSLICH die `draft`-Order an. KEINE Booklet-
 *    Generierung, KEIN Reel, KEINE E-Mail, KEIN Versand, KEIN Status über
 *    `draft`. `roappOrder.status` wird gelesen, aber IGNORIERT.
 *  - KEIN `analytics_events`-Insert (Backfill ≠ Anlage-Event, kein Consumer).
 *    Nur `item_description` + `short_summary`.
 *
 * Idempotenz: vor jedem Insert ein SELECT auf (business_id, external_ref) —
 * existiert die Order schon, wird sie übersprungen (KEIN upsert; es gibt keine
 * UNIQUE-Constraint, nur einen Index). Das Script ist gefahrlos re-runnbar.
 *
 * Isolation (§14.2): `business.id` (aufgelöst über `BUSINESS_EMAIL`) ist die
 * EINZIGE Vertrauensquelle; JEDE Query ist strikt darauf gescoped. service_role
 * ist CLI-only (.env.local) — NIE in den Client.
 *
 * Run (liest Keys aus .env.local):
 *
 *     pnpm dlx tsx scripts/import-roapp-orders.ts
 *
 * Benötigt SUPABASE_URL (oder NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
 * + ROAPP_API_KEY (+ optional ROAPP_DESCRIPTION_FIELD_ID) + ANTHROPIC_API_KEY
 * (für short_summary; fehlt er, bleibt short_summary null, der Auftrag wird
 * trotzdem angelegt).
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { getRoappOrder, type RoappOrder } from "../lib/roapp/client";
import { generateShortSummary } from "../lib/ai/short-summary";

/**
 * Die EINZIGE Importmenge: interne roapp-Order-IDs, vom Nutzer aus den
 * Web-UI-URLs abgelesen. Probelauf = genau EIN Eintrag; danach den Rest
 * eintragen (idempotent ⇒ der Probe-Auftrag wird übersprungen).
 */
const OBJECT_IDS: string[] = [
  // "123456",
];

/** Ziel-Betrieb. business.id wird darüber aufgelöst (Vertrauensquelle). */
const BUSINESS_EMAIL = "office@alinadax.com";

/** Der über BUSINESS_EMAIL aufgelöste Betrieb. */
type ImportBusiness = {
  id: string;
  name: string;
  default_language: string;
};

/**
 * Minimaler .env-Loader (dependency-frei, typsicher) — identisch zu
 * scripts/upload-ffmpeg.ts: setzt nur Keys, die noch nicht in der Umgebung
 * stehen. Werte können `=` enthalten ⇒ Split nur am ERSTEN `=`.
 */
function loadEnvFile(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // Datei fehlt → ignorieren
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Echte Fehlermeldung für die Logs extrahieren. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Kundenname REPLIZIERT aus app/api/webhook/[secret]/route.ts (buildCustomerName)
 * — der Webhook wird bewusst NICHT importiert/angefasst: first+last → name →
 * external_ref → generischer Platzhalter (Spalte ist NOT NULL).
 */
function buildCustomerName(
  order: RoappOrder,
  externalRef: string | null,
): string {
  const full =
    `${order.client?.first_name ?? ""} ${order.client?.last_name ?? ""}`.trim();
  if (full) return full;
  if (order.client?.name) return order.client.name;
  if (externalRef) return externalRef;
  return "Kunde";
}

async function main(): Promise<void> {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Fehlt: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL und/oder SUPABASE_SERVICE_ROLE_KEY (.env.local).",
    );
    process.exit(1);
  }
  if (!process.env.ROAPP_API_KEY) {
    console.error("Fehlt: ROAPP_API_KEY (.env.local).");
    process.exit(1);
  }

  if (OBJECT_IDS.length === 0) {
    console.error(
      "OBJECT_IDS ist leer — trage die internen roapp-Order-IDs ein (Probelauf: EINE ID).",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Betrieb auflösen — fehlt er, hart abbrechen. business.id ist die EINZIGE
  // Vertrauensquelle (§14.2); jede folgende Query ist darauf gescoped.
  const { data: business, error: bizError } = await supabase
    .from("businesses")
    .select("id, name, default_language")
    .eq("business_email", BUSINESS_EMAIL)
    .maybeSingle<ImportBusiness>();
  if (bizError) {
    console.error(`Betriebs-Lookup fehlgeschlagen: ${bizError.message}`);
    process.exit(1);
  }
  if (!business) {
    console.error(
      `Kein Betrieb mit business_email="${BUSINESS_EMAIL}" gefunden — Abbruch.`,
    );
    process.exit(1);
  }

  console.log(
    `Betrieb: ${business.name} (id=${business.id}, lang=${business.default_language})`,
  );
  console.log(`Importiere ${OBJECT_IDS.length} roapp-Order-ID(s)…\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const objectId of OBJECT_IDS) {
    // Pro objectId eigener try/catch → loggen + weitermachen (nicht-blockierend).
    try {
      let roappOrder: RoappOrder;
      try {
        roappOrder = await getRoappOrder(objectId);
      } catch (error) {
        console.error(
          `[skip] object_id=${objectId}: roapp-Abruf fehlgeschlagen: ${errMessage(error)}`,
        );
        failed += 1;
        continue;
      }

      const externalRef = roappOrder.id_label;
      if (!externalRef) {
        console.error(
          `[skip] object_id=${objectId}: kein id_label (external_ref) — kein Insert.`,
        );
        skipped += 1;
        continue;
      }

      // Idempotenz: existiert die Order (business_id, external_ref) bereits?
      const { data: existing, error: lookupError } = await supabase
        .from("orders")
        .select("id")
        .eq("business_id", business.id)
        .eq("external_ref", externalRef)
        .maybeSingle<{ id: string }>();
      if (lookupError) {
        console.error(
          `[fail] external_ref=${externalRef} (object_id=${objectId}): Idempotenz-Lookup fehlgeschlagen: ${lookupError.message}`,
        );
        failed += 1;
        continue;
      }
      if (existing) {
        console.log(
          `[skip] external_ref=${externalRef}: existiert bereits (id=${existing.id}).`,
        );
        skipped += 1;
        continue;
      }

      // KI-Kurzbeschreibung wie bei der Live-Anlage. Fehler ⇒ null, Order wird
      // trotzdem angelegt.
      let shortSummary: string | null = null;
      if (roappOrder.raw_description) {
        try {
          shortSummary = await generateShortSummary(
            roappOrder.raw_description,
            business.default_language,
          );
        } catch (error) {
          console.error(
            `[warn] external_ref=${externalRef}: short_summary-Generierung fehlgeschlagen (Order wird ohne angelegt): ${errMessage(error)}`,
          );
          shortSummary = null;
        }
      }

      // Anlage repliziert die Webhook-Felder (handleOrderCreated), via
      // service_role + business.id gescoped. §13.5: consent NIE per Backfill.
      const { data: inserted, error: insertError } = await supabase
        .from("orders")
        .insert({
          business_id: business.id,
          customer_name: buildCustomerName(roappOrder, externalRef),
          customer_email: roappOrder.client?.email ?? null,
          customer_phone: null,
          external_ref: externalRef,
          item_description: roappOrder.raw_description,
          short_summary: shortSummary,
          language: business.default_language,
          status: "draft",
          /* BEWUSST `false`, obwohl die Live-Anlagewege (Webhook + Portal) die
             Einwilligung seit 09.08.2026 automatisch setzen: Dieses Script
             trägt HISTORISCHE Aufträge nach, für die niemand bestätigen kann,
             dass an der Kassa unterschrieben wurde. Es folgt damit derselben
             Linie wie der Bestand — kein rückwirkendes Setzen. */
          consent_given: false,
          consent_at: null,
        })
        .select("id")
        .single<{ id: string }>();
      if (insertError || !inserted) {
        console.error(
          `[fail] external_ref=${externalRef} (object_id=${objectId}): Insert fehlgeschlagen: ${insertError?.message ?? "keine Zeile zurück"}`,
        );
        failed += 1;
        continue;
      }

      console.log(
        `[created] external_ref=${externalRef} → order id=${inserted.id}${shortSummary ? ` ("${shortSummary}")` : ""}`,
      );
      created += 1;
    } catch (error) {
      console.error(
        `[fail] object_id=${objectId}: unerwarteter Fehler: ${errMessage(error)}`,
      );
      failed += 1;
    }
  }

  console.log(
    `\n✅ Fertig: created ${created} / skipped ${skipped} / failed ${failed} (von ${OBJECT_IDS.length}).`,
  );
}

main().catch((error: unknown) => {
  console.error("Unerwarteter Fehler:", errMessage(error));
  process.exit(1);
});
