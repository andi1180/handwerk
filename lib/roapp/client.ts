// Nur server-seitig. NIEMALS in Client Components importieren.
// NIEMALS mit NEXT_PUBLIC_ prefixen (der Key darf nie ins Client-Bundle).
//
// roapp-API-Client für den Inbound-Webhook-Connector (§12). Reichert ein
// Webhook-Event über GENAU EINEN Call an: `GET /orders/{object_id}` liefert die
// Order inkl. eingebettetem `client`-Objekt (E-Mail/Name), `status.name` im
// Klartext und `id_label` (= unser `external_ref`) — KEIN zweiter Contact-Call.

/** Eingebettetes roapp-Kundenobjekt (in der Order-Antwort). */
export type RoappOrderClient = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  /** Anzeigename (Fallback, falls first/last fehlen). */
  name: string | null;
};

/** roapp-Status der Order. */
export type RoappOrderStatus = {
  /**
   * Numerische Status-ID der API. NUR informativ — fürs Matching IMMER
   * `name` verwenden: die ID aus dem Webhook-Payload (`metadata.new.id`) stimmt
   * NICHT mit dieser API-ID überein.
   */
  id: number | null;
  /** Klartext-Name, z. B. "Abgeholt". DIE Quelle fürs Status-Matching. */
  name: string | null;
};

/** Aus `GET /orders/{id}` extrahierte, für den Connector relevante Felder. */
export type RoappOrder = {
  id: string | null;
  /** Auftragsnummer (z. B. "N1324") = unser `external_ref`. */
  id_label: string | null;
  status: RoappOrderStatus | null;
  client: RoappOrderClient | null;
};

/**
 * roapp-Statusname, der „abgeholt" bedeutet → triggert die Auslieferung.
 * Per Env `ROAPP_PICKED_UP_STATUS_NAME` überschreibbar (Betriebe benennen den
 * Status evtl. anders), Default "Abgeholt".
 */
export const ROAPP_PICKED_UP_STATUS_NAME =
  process.env.ROAPP_PICKED_UP_STATUS_NAME?.trim() || "Abgeholt";

const ROAPP_API_BASE = "https://api.roapp.io";

/** Timeout für den API-Call, damit eine hängende roapp-API die Function nicht blockiert. */
const ROAPP_TIMEOUT_MS = 10_000;

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

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Coerce einer id (string/number) auf string. */
function asIdString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

/**
 * Wählt das eigentliche Order-Objekt: manche APIs hüllen die Ressource in
 * `{ data: {...} }`. Wir nehmen den verschachtelten Block nur, wenn er die
 * erwarteten Order-Felder trägt — sonst die Wurzel direkt.
 */
function pickOrderObject(raw: unknown): Record<string, unknown> {
  const root = asRecord(raw);
  const data = asRecord(root.data);
  if ("id_label" in data || "client" in data || "status" in data) return data;
  return root;
}

/** Defensive, typsichere Extraktion der relevanten Order-Felder (kein `any`). */
export function parseRoappOrder(raw: unknown): RoappOrder {
  const order = pickOrderObject(raw);
  const client = asRecord(order.client);
  const status = asRecord(order.status);

  const hasClient =
    order.client !== undefined && order.client !== null;
  const hasStatus =
    order.status !== undefined && order.status !== null;

  return {
    id: asIdString(order.id),
    id_label: asString(order.id_label),
    status: hasStatus
      ? { id: asNumber(status.id), name: asString(status.name) }
      : null,
    client: hasClient
      ? {
          email: asString(client.email),
          first_name: asString(client.first_name),
          last_name: asString(client.last_name),
          name: asString(client.name),
        }
      : null,
  };
}

/**
 * Lädt eine roapp-Order über die API. Wirft bei fehlendem Key, Nicht-2xx,
 * Timeout/Netzfehler oder ungültigem JSON — der Webhook-Endpoint fängt das und
 * antwortet 200 `enrich_failed` (kein Retry-Sturm, §12-Robustheit).
 */
export async function getRoappOrder(objectId: string): Promise<RoappOrder> {
  const apiKey = process.env.ROAPP_API_KEY;
  if (!apiKey) {
    throw new Error("ROAPP_API_KEY is not set");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROAPP_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${ROAPP_API_BASE}/orders/${encodeURIComponent(objectId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`roapp GET /orders/${objectId} → HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  return parseRoappOrder(json);
}
