import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { websiteTextDraftForOrder } from "@/lib/ai/website-text";

/**
 * POST /api/portal/orders/[id]/website-text — erzeugt den Textentwurf „Was
 * wurde gemacht“ (`orders.website_text`, 0017) und legt ihn ab.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WOZU EIN EIGENER ENDPUNKT, WO DAS UMLEGEN DEN TEXT OHNEHIN ERZEUGT?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Damit Alina den Entwurf SIEHT, bevor sie speichert. Die Erzeugung im
 * PATCH-Handler (`app/api/portal/orders/[id]/route.ts`) ist das Auffangnetz:
 * Sie greift, wenn beim Umlegen trotzdem kein Text dasteht, und liefert dann
 * einen Text, den bis zum nächsten Öffnen der Seite niemand gelesen hat.
 *
 * Dieser Endpunkt läuft beim KLICK AUF DEN SCHALTER, solange das Textfeld leer
 * ist. Der Entwurf landet im Formular, ist sofort bearbeitbar und trägt das
 * Kennzeichen „KI-Entwurf, ungeprüft“, bis ihn jemand ändert.
 *
 * Beide Wege teilen sich `websiteTextDraftForOrder` — derselbe Prompt, dieselben
 * Quellen, kein zweiter Textgenerator.
 *
 * ⚠️ DER ENTWURF WIRD GESPEICHERT, nicht nur zurückgegeben. Zwei Gründe:
 *    (1) Nur so kann der PATCH-Handler später ableiten, ob der abgespeicherte
 *        Text noch der unveränderte Entwurf ist — er vergleicht ihn mit dem
 *        gespeicherten Stand. Ein Kennzeichen, das der Client behauptet, wäre
 *        eine Behauptung; dieses hier ist eine Feststellung.
 *    (2) Bricht Alina danach ab, ist der Entwurf beim nächsten Mal schon da und
 *        kostet keinen zweiten Modell-Aufruf.
 *    Unbedenklich, weil `website_text` bei `website_visible = false` ohnehin
 *    beliebig ist (siehe Migration 0017) — der Auftrag wird davon nicht
 *    sichtbar.
 *
 * ⚠️ ÜBERSCHREIBT NIE: Steht schon ein Text da, wird er unverändert
 *    zurückgegeben, ohne Modell-Aufruf. Die Oberfläche ruft dann zwar gar nicht
 *    erst an — aber die Regel „kein Überschreiben“ gehört auf den Server, nicht
 *    in die Annahme über den Client.
 *
 * ISOLATION: AUTHENTICATED Server-Client (kein `service_role`). 401/403 ohne
 * User/Betrieb. Die Order wird über RLS geladen — fremde/fehlende id ⇒ 404. Das
 * Update ist defensiv auf `id` + `business_id` gefiltert; `business_id` kommt
 * ausschließlich aus der geladenen Order, nie aus der Anfrage.
 */

// Der Modell-Aufruf blockiert eine Nutzer-Aktion; er hat eine eigene Zeitgrenze
// (30 s, siehe lib/ai/website-text.ts). `maxDuration` liegt darüber, damit die
// Zeitüberschreitung als klarer Fehlercode ankommt statt als abgeschnittene
// Funktion.
export const runtime = "nodejs";
export const maxDuration = 60;

type OrderRow = {
  id: string;
  business_id: string;
  item_description: string | null;
  language: string;
  website_text: string | null;
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

  const { data: order } = await supabase
    .from("orders")
    .select("id, business_id, item_description, language, website_text")
    .eq("id", orderId)
    .maybeSingle<OrderRow>();
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Vorhandener Text bleibt vorhanden. `ki_entwurf: false`, weil über einen
  // Text, der schon dastand, hier nichts Neues bekannt ist — das Kennzeichen in
  // der Datenbank bleibt unangetastet.
  const bestehend = order.website_text?.trim();
  if (bestehend) {
    return NextResponse.json(
      { text: bestehend, generated: false, ki_entwurf: false },
      { status: 200 },
    );
  }

  let text: string;
  try {
    text = await websiteTextDraftForOrder(supabase, order);
  } catch (err) {
    console.error(`[website-text] generation_failed (order ${orderId}):`, err);
    // 502 und nicht 500: Gescheitert ist der Aufruf beim Modell-Anbieter, nicht
    // etwas bei uns. Derselbe Code wie im PATCH-Handler, damit die Oberfläche
    // beide Wege gleich behandeln kann.
    return NextResponse.json(
      { error: "text_generation_failed" },
      { status: 502 },
    );
  }

  const { error } = await supabase
    .from("orders")
    .update({ website_text: text, website_text_ki_entwurf: true })
    .eq("id", order.id)
    .eq("business_id", order.business_id);

  if (error) {
    console.error(`[website-text] update_failed (order ${orderId}):`, error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json(
    { text, generated: true, ki_entwurf: true },
    { status: 200 },
  );
}
