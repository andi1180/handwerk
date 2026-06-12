/**
 * Vendor-neutrale Klassifizierung des Inbound-Webhook-Payloads (§12).
 *
 * PLAIN-Modul — KEIN service_role, KEINE Secrets, KEIN API-Key: dem Endpunkt ist
 * egal, ob der POST von roapp-nativ, Zapier, Make oder einem manuellen Call
 * kommt (§12.1). Dieses Modul liest nur Struktur aus dem Body und entscheidet,
 * welches der zwei Events vorliegt; die roapp-spezifische Anreicherung
 * (`lib/roapp/client.ts`) und die Seiteneffekte liegen im Endpoint.
 *
 * Erkannte Events (jeweils nur für `object_type === "order"`):
 *   event_name endet auf ".created"        → "created"     (Order anlegen)
 *   event_name endet auf ".status.changed" → "picked_up"   (ggf. ausliefern)
 *
 * WICHTIG: Die numerische Status-ID aus dem Payload (`metadata.new.id`) wird
 * hier bewusst IGNORIERT — sie stimmt nicht mit der API-`status.id` überein. Ob
 * der Status „abgeholt" bedeutet, entscheidet der Endpoint über den
 * API-Nachschlag (`status.name`), nicht über den Payload.
 */

export type WebhookEventKind = "created" | "picked_up";

/** Aus dem rohen Webhook-Body extrahierte, vendor-neutrale Felder. */
export type ParsedWebhook = {
  /** roapp: `event_name` (Fallback `event`/`type`). */
  eventName: string | null;
  /** `context.object_type` (Fallback top-level `object_type`). */
  objectType: string | null;
  /** `context.object_id` (Fallback top-level `object_id`) — id für den API-Call. */
  objectId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Coerce einer id (string/number) auf string. */
function asIdString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

/**
 * Extrahiert Event-Name, Objekt-Typ und Objekt-ID defensiv aus dem Body.
 * roapp verschachtelt die Objekt-Infos unter `context`; wir akzeptieren
 * zusätzlich Top-Level-Felder (Zapier/Make/manuell).
 */
export function parseWebhookBody(body: unknown): ParsedWebhook {
  const root = asRecord(body);
  const context = asRecord(root.context);

  return {
    eventName: asString(root.event_name) ?? asString(root.event) ?? asString(root.type),
    objectType: asString(context.object_type) ?? asString(root.object_type),
    objectId: asIdString(context.object_id) ?? asIdString(root.object_id),
  };
}

/**
 * Ordnet einen geparsten Payload einem der beiden Events zu. Nur für
 * `object_type === "order"`; alles andere ⇒ `null` (Endpoint: ignoriert).
 */
export function classifyEvent(parsed: ParsedWebhook): WebhookEventKind | null {
  if (parsed.objectType !== "order") return null;
  const name = parsed.eventName?.toLowerCase();
  if (!name) return null;
  if (name.endsWith(".created")) return "created";
  if (name.endsWith(".status.changed")) return "picked_up";
  return null;
}
