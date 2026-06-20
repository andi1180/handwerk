// Nur server-seitig. NIEMALS in Client Components importieren.
// NIEMALS mit NEXT_PUBLIC_ prefixen.

/**
 * BulkSMS-Client (Feature 3a — SMS-Versand). Versendet eine einzelne SMS über
 * die BulkSMS JSON REST API v1 (`POST /v1/messages`) mit HTTP-Basic-Auth.
 *
 * SICHERHEIT: Token-ID + Secret kommen ausschließlich aus den server-only Envs
 * `BULKSMS_TOKEN_ID` / `BULKSMS_TOKEN_SECRET` (NIE `NEXT_PUBLIC`, nie im Client).
 * Muster wie `lib/email/resend.ts` / `lib/ai/anthropic.ts`.
 *
 * Fehlerverhalten (bewusst): AUTH-/401-Fehler (falsches ID/Secret-Paar) werden
 * KLAR geloggt UND zurückgegeben — NICHT geschluckt, damit eine kaputte
 * Konfiguration sofort sichtbar ist. Der Versand wird vom Aufrufer NICHT-
 * BLOCKIEREND behandelt (die Auslieferung gilt trotzdem als erfolgt), das
 * Ergebnis ist aber für den Operator sichtbar.
 */

/** BulkSMS JSON REST API v1 — Single-Message-Endpoint. */
const BULKSMS_ENDPOINT = "https://api.bulksms.com/v1/messages";

/** Antwortet die API nicht, wird hart abgebrochen (wie der roapp-Client). */
const REQUEST_TIMEOUT_MS = 10_000;

export type SmsSendResult = { ok: true } | { ok: false; error: string };

/** True, wenn der SMS-Versand konfiguriert ist (beide Token-Teile gesetzt). */
export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.BULKSMS_TOKEN_ID && process.env.BULKSMS_TOKEN_SECRET,
  );
}

/**
 * Versendet eine einzelne SMS. `to` (Empfänger) und optional `from` (Absender)
 * müssen bereits normalisiert sein (E.164, s. `lib/sms/phone.ts`). Gibt
 * `{ ok }` bzw. `{ ok: false, error }` zurück — wirft nie.
 */
export async function sendSms({
  to,
  body,
  from,
}: {
  to: string;
  body: string;
  from?: string;
}): Promise<SmsSendResult> {
  const tokenId = process.env.BULKSMS_TOKEN_ID;
  const tokenSecret = process.env.BULKSMS_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    const error = "BULKSMS_TOKEN_ID / BULKSMS_TOKEN_SECRET ist nicht gesetzt";
    console.error("bulksms: not configured", { step: "config" });
    return { ok: false, error };
  }

  // HTTP Basic Auth: base64("tokenId:tokenSecret").
  const auth = Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64");
  const payload: { to: string; body: string; from?: string } = { to, body };
  if (from) payload.from = from;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(BULKSMS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.error("bulksms: request failed", { step: "fetch", message });
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 401 = falsches Token-Paar ⇒ KLAR loggen (nicht schlucken). Body für die
    // Diagnose mitnehmen (BulkSMS liefert eine JSON-Fehlerbeschreibung).
    const text = await res.text().catch(() => "");
    console.error("bulksms: send failed", {
      step: "response",
      status: res.status,
      body: text.slice(0, 500),
    });
    return { ok: false, error: `bulksms ${res.status}: ${text.slice(0, 200)}` };
  }

  return { ok: true };
}
