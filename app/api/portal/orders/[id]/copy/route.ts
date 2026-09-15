import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";

/**
 * POST /api/portal/orders/[id]/copy — dupliziert einen Auftrag als LEERES Template.
 *
 * Hintergrund: zu EINEM roapp-Auftrag gehören oft mehrere valooro-Aufträge
 * (mehrere Änderungen für denselben Kunden). Die Kopie übernimmt nur die
 * Kundendaten + den Auftragskontext und ist danach ein ganz normaler neuer
 * `draft` — KEIN `order_media`, KEIN Booklet, kein `picked_up_at`/`archived_at`,
 * Website-Publikationsfelder auf Default.
 *
 * Nummerierung: die Kopie bekommt `{Basis-Nr}-NN`. Basis ist die externe Referenz
 * des Originals OHNE eine bereits vorhandene `-NN`-Endung — kopiert man also eine
 * Kopie, entsteht wieder `{Basis}-NN` und keine verschachtelte Kette wie `-01-01`.
 *
 * Einsortierung: `created_at` = größter Zeitstempel unter Original + Geschwistern
 * + 1 ms. Damit steht die neue Kopie in der nach `created_at DESC` sortierten
 * Liste immer direkt über dem Original und über allen bisherigen Kopien, während
 * das angezeigte Datum derselbe Kalendertag bleibt.
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). 401/403 ohne
 * User/Betrieb. Original über RLS + defensiven `business_id`-Filter geladen —
 * fremde/fehlende id ⇒ 404. `business_id` stammt AUSSCHLIESSLICH aus der Session,
 * niemals aus dem Body (es gibt gar keinen Body).
 */

/** Endung `-NN` (zweistellige Kopien-Nummer) am Ende einer externen Referenz. */
const COPY_SUFFIX = /-(\d{2})$/;

type OrderRow = {
  id: string;
  business_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  item_description: string | null;
  short_summary: string | null;
  external_ref: string | null;
  language: string;
  created_at: string;
};

export async function POST(
  _request: Request,
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

  // Original über RLS + defensiven business_id-Filter — fremde/fehlende id ⇒ 404.
  const { data: original } = await supabase
    .from("orders")
    .select(
      "id, business_id, customer_name, customer_email, customer_phone, item_description, short_summary, external_ref, language, created_at",
    )
    .eq("id", orderId)
    .eq("business_id", business.id)
    .maybeSingle<OrderRow>();

  if (!original) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const baseRef = original.external_ref
    ? original.external_ref.replace(COPY_SUFFIX, "")
    : null;

  let newExternalRef: string | null = null;
  let maxCreatedMs = Date.parse(original.created_at);

  if (baseRef) {
    // Geschwister = die Basis-Nummer selbst + alle `{Basis}-NN`-Kopien. EIN
    // `.like`-Filter deckt beides ab (`{Basis}%`); die exakte Zuordnung macht
    // danach der JS-Filter unten.
    //
    // ⚠️ Bewusst `.like()` statt `.or()`: die externe Referenz ist Fremd-/
    // Freitext (roapp-`id_label` bzw. Handeingabe im Anlage-Formular) und würde
    // mit einem Komma die `.or()`-Syntax zerlegen. Der Projekt-Konvention
    // entsprechend (siehe Sanitisierung in `lib/orders/orders-query.ts`) wird
    // hier gar nicht erst in eine `.or()`-Liste interpoliert. `%`/`_` in der
    // Referenz können das LIKE-Muster aufweiten — der JS-Filter schneidet
    // Über-Treffer exakt wieder weg.
    const { data: siblings } = await supabase
      .from("orders")
      .select("external_ref, created_at")
      .eq("business_id", business.id)
      .like("external_ref", `${baseRef}%`)
      .returns<{ external_ref: string | null; created_at: string }[]>();

    let maxSuffix = 0;
    for (const sibling of siblings ?? []) {
      const ref = sibling.external_ref;
      if (!ref) continue;
      // Exakt: entweder die Basis-Nummer selbst oder `{Basis}-NN`.
      const isBase = ref === baseRef;
      const suffixMatch = ref.startsWith(`${baseRef}-`)
        ? COPY_SUFFIX.exec(ref.slice(baseRef.length))
        : null;
      if (!isBase && !suffixMatch) continue;

      if (suffixMatch) {
        maxSuffix = Math.max(maxSuffix, Number(suffixMatch[1]));
      }
      const createdMs = Date.parse(sibling.created_at);
      if (Number.isFinite(createdMs)) {
        maxCreatedMs = Math.max(maxCreatedMs, createdMs);
      }
    }

    // Zweistellig gepaddet (`-01`, `-02`, …). Ab der 100. Kopie wird die Endung
    // dreistellig — bei einer Handvoll Änderungen pro Auftrag kein realer Fall.
    newExternalRef = `${baseRef}-${String(maxSuffix + 1).padStart(2, "0")}`;
  }

  // Ohne externe Referenz gibt es keine Geschwister zum Nachschlagen: die Kopie
  // setzt dann nur auf dem Original auf (bekannte Einschränkung — mehrere
  // referenzlose Kopien desselben Originals können denselben Millisekunden-
  // Stempel bekommen, ihre Reihenfolge untereinander ist dann unbestimmt; über
  // dem Original stehen sie aber immer).
  const newCreatedAt = new Date(
    (Number.isFinite(maxCreatedMs) ? maxCreatedMs : Date.now()) + 1,
  ).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .insert({
      business_id: business.id,
      customer_name: original.customer_name,
      customer_email: original.customer_email,
      customer_phone: original.customer_phone,
      item_description: original.item_description,
      short_summary: original.short_summary,
      external_ref: newExternalRef,
      language: original.language,
      status: "draft",
      // Einwilligung liegt an der Kassa immer vor — wie beim manuellen Anlegen
      // (`app/api/portal/orders/route.ts`).
      consent_given: true,
      consent_at: new Date().toISOString(),
      created_at: newCreatedAt,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    console.error(`[order copy] insert_failed (order ${orderId}):`, error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
