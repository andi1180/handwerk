import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/components/order-status-badge";

/** Erlaubte Medien-Tags (Spiegel der DB-Check-Constraint auf `order_media.tag`). */
export type MediaTag = "vorher" | "nachher" | "prozess";

/**
 * Bild-Kategorie (Spiegel der DB-Check-Constraint auf `order_media.category`,
 * Migration 0010). Steuert den festen Booklet-Aufbau: `before` direkt nach dem
 * Intro, `after` zuletzt vor dem Outro, `process` dazwischen (Standard + Pflicht
 * fürs Generieren). before/after je max 1 pro Auftrag (App-enforced); Videos sind
 * IMMER `process`.
 */
export type MediaCategory = "before" | "after" | "process";

/** Auftrag in der Detailansicht — alle für die Seite benötigten Felder. */
export type OrderDetail = {
  id: string;
  business_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  external_ref: string | null;
  item_description: string | null;
  status: OrderStatus;
  created_at: string;
  /* Website-Veröffentlichung (Migration 0015 + 0017).
     `website_category` ist die Art der Arbeit am AUFTRAG und hat nichts mit
     `OrderMedia.category` (before/after/process) zu tun.

     ⚠️ Hier stand „es existiert KEINE Anbindung an die Website". Das gilt seit
     Migration 0016 nicht mehr: `app/api/website/orders/route.ts` liefert diese
     Werte an die Website aus. Handwerk SENDET weiterhin nichts (Pull, kein
     Push) — aber die Spalten werden gelesen. */
  website_visible: boolean;
  website_category: string | null;
  website_clothing_type: string | null;
  website_work_hours: number | null;
  website_price: number | null;
  /* „Was wurde gemacht" — von Hand geschrieben (Migration 0017). Pflicht ab 80
     Zeichen, sobald sichtbar. NICHT `item_description`: das ist die
     Annahmenotiz vom Tresen (Maße, Kürzel) und taugt nachweislich nicht als
     Textquelle. */
  website_text: string | null;
  /* Einwilligung des Kunden in die Veröffentlichung (Spalten aus 0001).
     Grundlage ist das unterschriebene Formular an der Kassa — hier wird nur
     festgehalten, DASS es vorliegt, und wann das eingetragen wurde.

     ⚠️ Voraussetzung für `website_visible = true` (Route Handler, 400
     `consent_required`). Aufträge aus dem roapp-Webhook starten nach §13.5
     immer auf `false`; nachtragen lässt sich das ab jetzt im Website-Block der
     Detailseite. */
  consent_given: boolean;
  consent_at: string | null;
};

/** Ein Medien-Asset eines Auftrags. */
export type OrderMedia = {
  id: string;
  media_type: "photo" | "video";
  storage_path: string;
  keyword: string | null;
  tag: MediaTag | null;
  caption: string | null;
  category: MediaCategory;
  sort_order: number;
};

/**
 * Lädt einen Auftrag per id über den AUTHENTICATED Server-Client.
 * RLS skopiert auf den Betrieb des Nutzers — eine fremde oder fehlende id
 * liefert `null` (die Detailseite ruft dann `notFound()`).
 */
export async function getOrderById(id: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select(
      "id, business_id, customer_name, customer_email, customer_phone, external_ref, item_description, status, created_at, website_visible, website_category, website_clothing_type, website_work_hours, website_price, website_text, consent_given, consent_at",
    )
    .eq("id", id)
    .maybeSingle<OrderDetail>();
  return data ?? null;
}

/**
 * Lädt die Medien eines Auftrags über den AUTHENTICATED Server-Client
 * (RLS-skopiert), sortiert nach `sort_order` ASC.
 */
export async function getOrderMedia(orderId: string): Promise<OrderMedia[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_media")
    .select("id, media_type, storage_path, keyword, tag, caption, category, sort_order")
    .eq("order_id", orderId)
    .order("sort_order", { ascending: true })
    .returns<OrderMedia[]>();
  return data ?? [];
}
