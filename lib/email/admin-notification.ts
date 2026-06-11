// Nur server-seitig. NIEMALS in Client Components importieren.
import { getResend } from "./resend";

/**
 * Admin-Benachrichtigung über eine neue Self-Service-Registrierung (Option C).
 *
 * Geht an die fest hinterlegte Admin-Adresse (kein ADMIN_EMAIL-Env nötig).
 * Absender: `"Valooro" <hello@valooro.com>` — valooro.com ist die verifizierte
 * Domain (SPF/DKIM). Inhalt: Betriebsname + E-Mail des neuen Betriebs + ein
 * SQL-Schnipsel zum Freischalten. NICHT-BLOCKIEREND: der Aufrufer fängt einen
 * Fehlschlag — die Registrierung steht trotzdem.
 */

/** Verifizierte Absender-Adresse (valooro.com). */
const FROM_ADDRESS = "hello@valooro.com";

/** Fest hinterlegte Admin-Empfängeradresse für Registrierungs-Hinweise. */
const ADMIN_ADDRESS = "andreas.dax@valooro.com";

export type RegistrationNotificationParams = {
  /** Name des neu registrierten Betriebs. */
  businessName: string;
  /** E-Mail (business_email) des neu registrierten Betriebs. */
  email: string;
};

/** Minimaler HTML-Escape für interpolierte Werte. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Versendet die Admin-Benachrichtigung über Resend. Wirft bei fehlendem Key
 * (getResend) oder einem Resend-Fehler — der Aufrufer behandelt das
 * NICHT-BLOCKIEREND (die Registrierung gilt trotzdem als erfolgt).
 */
export async function sendRegistrationNotification(
  params: RegistrationNotificationParams,
): Promise<void> {
  const { businessName, email } = params;
  const resend = getResend();

  // Informativer SQL-Schnipsel zum Freischalten (wird nicht ausgeführt, nur angezeigt).
  const activationSql = `update businesses set status='active' where business_email='${email}';`;

  const subject = `Neue Registrierung: ${businessName}`;

  const text = [
    "Ein neuer Betrieb hat sich registriert (Status: pending).",
    "",
    `Betrieb:  ${businessName}`,
    `E-Mail:   ${email}`,
    "",
    "Zum Freischalten im Supabase SQL-Editor ausführen:",
    activationSql,
  ].join("\n");

  const eName = escapeHtml(businessName);
  const eEmail = escapeHtml(email);
  const eSql = escapeHtml(activationSql);
  const html = `<!DOCTYPE html>
<html lang="de">
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2b2b2b;">
    <p style="margin:0 0 16px;font-size:15px;">Ein neuer Betrieb hat sich registriert (Status: <strong>pending</strong>).</p>
    <p style="margin:0 0 6px;font-size:14px;"><strong>Betrieb:</strong> ${eName}</p>
    <p style="margin:0 0 20px;font-size:14px;"><strong>E-Mail:</strong> ${eEmail}</p>
    <p style="margin:0 0 8px;font-size:14px;">Zum Freischalten im Supabase SQL-Editor ausführen:</p>
    <pre style="margin:0;padding:12px 14px;background:#f4f2ee;border:1px solid #e7e2d8;border-radius:8px;font-size:13px;white-space:pre-wrap;word-break:break-all;">${eSql}</pre>
  </body>
</html>`;

  const { error } = await resend.emails.send({
    from: `"Valooro" <${FROM_ADDRESS}>`,
    to: ADMIN_ADDRESS,
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(`resend: ${error.message}`);
  }
}
