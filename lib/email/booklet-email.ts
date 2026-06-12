// Nur server-seitig. NIEMALS in Client Components importieren.
import { getResend } from "./resend";

/**
 * Booklet-Auslieferungs-E-Mail (Schritt 9c-1).
 *
 * Absender: `"{Betrieb}" <hello@valooro.com>` — valooro.com ist die verifizierte
 * Domain (SPF/DKIM), der Betriebsname ist nur der Anzeigename. reply-to = die
 * öffentliche Betriebs-Kontakt-Mail (falls gesetzt), damit der Kunde direkt an
 * den Betrieb antwortet, nicht an Valooro.
 *
 * Inhalt DE, bewusst „rich" (nicht nur nackter Link) für Deliverability:
 * personalisierter Betreff, Anrede mit Kundenname, ein Satz Kontext, Link als
 * beschrifteter Button + Klartext-Fallback, kurze Signatur. HTML + Plaintext.
 *
 * i18n-ready: die Texte sind aktuell DE (MVP); `order.language` kann später
 * einen Locale-Parameter speisen.
 */

/** Verifizierte Absender-Adresse (valooro.com). */
const FROM_ADDRESS = "hello@valooro.com";

/** Gold-Akzent für den Button (DEFAULT_BRANDING.primary_color). */
const ACCENT = "#C4A95B";

export type BookletEmailParams = {
  /** Empfänger (Kunden-E-Mail). */
  to: string;
  /** Anrede-Name (orders.customer_name). */
  customerName: string;
  /** Anzeigename des Absenders + Signatur. */
  businessName: string;
  /** Vollständige Booklet-URL inkl. Kunden-Marker (`?c=1`). */
  bookletUrl: string;
  /** Öffentliche Betriebs-Kontakt-Mail als reply-to (optional). */
  replyTo?: string;
  /** Website des Betriebs (settings.website_url) — als seriöser Abschluss, optional. */
  websiteUrl?: string;
};

/** Minimaler HTML-Escape für interpolierte Werte (Name/Betrieb/URL). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Anzeigename für den From-Header: header-brechende Zeichen entfernen und in
 * Anführungszeichen setzen (RFC-5322-sicher auch bei Kommas/Sonderzeichen).
 */
function fromDisplayName(name: string): string {
  const safe = name.replace(/["\\<>\r\n]/g, "").trim();
  return safe.length > 0 ? safe : "Valooro";
}

/**
 * Normalisiert die hinterlegte Website (Freitext, mit/ohne Protokoll) auf eine
 * klickbare `href` (mit Protokoll) + eine kompakte Anzeige (ohne Protokoll/
 * Trailing-Slash). Leere Eingabe ⇒ null (kein Website-Block).
 */
function normalizeWebsite(
  raw: string | undefined,
): { href: string; display: string } | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const display = trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return { href, display };
}

/** Baut HTML- + Plaintext-Body der Auslieferungs-E-Mail. */
function renderBookletEmail(params: {
  customerName: string;
  businessName: string;
  bookletUrl: string;
  websiteUrl?: string;
}): { html: string; text: string } {
  const name = params.customerName.trim();
  const greeting = name.length > 0 ? `Hallo ${name},` : "Hallo,";
  const business = params.businessName.trim() || "Ihr Betrieb";
  const url = params.bookletUrl;
  const website = normalizeWebsite(params.websiteUrl);

  const text = [
    greeting,
    "",
    `${business} hat für Sie ein persönliches Booklet erstellt. Schauen Sie sich Ihre Bilder und die Geschichte dazu an:`,
    "",
    url,
    "",
    "Viele Grüße",
    business,
    // Website als seriöser Abschluss (nur wenn hinterlegt).
    ...(website ? ["", website.display] : []),
  ].join("\n");

  // E-Mail-HTML: Tabellen-Layout + Inline-Styles für maximale Client-Kompatibilität.
  const eName = escapeHtml(greeting);
  const eBusiness = escapeHtml(business);
  const eUrl = escapeHtml(url);
  // Website-Abschluss (nur wenn hinterlegt): Betriebsname + klickbare Domain,
  // dezent unter der Signatur.
  const websiteBlock = website
    ? `
                <div style="border-top:1px solid #eeeae0;margin:20px 0 0;padding-top:16px;text-align:center;">
                  <a href="${escapeHtml(website.href)}" style="font-size:13px;font-weight:600;color:${ACCENT};text-decoration:none;">${eBusiness}</a>
                  <span style="font-size:13px;color:#aaaaaa;"> · </span>
                  <a href="${escapeHtml(website.href)}" style="font-size:13px;color:#888888;text-decoration:none;">${escapeHtml(website.display)}</a>
                </div>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ihr Booklet von ${eBusiness}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2b2b2b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Ihr persönliches Booklet von ${eBusiness} ist fertig.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e7e2d8;">
            <tr>
              <td style="padding:32px 28px;">
                <p style="margin:0 0 16px;font-size:16px;">${eName}</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.55;">${eBusiness} hat für Sie ein persönliches Booklet erstellt. Schauen Sie sich Ihre Bilder und die Geschichte dazu an:</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td align="center" style="border-radius:8px;background:${ACCENT};">
                      <a href="${eUrl}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Booklet ansehen</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#888888;">Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br /><a href="${eUrl}" style="color:#888888;">${eUrl}</a></p>
                <div style="border-top:1px solid #eeeae0;margin:0 0 20px;"></div>
                <p style="margin:0;font-size:15px;line-height:1.55;">Viele Grüße<br />${eBusiness}</p>${websiteBlock}
              </td>
            </tr>
          </table>
          <p style="max-width:480px;margin:18px auto 0;font-size:12px;color:#aaaaaa;text-align:center;">Gesendet über Valooro</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { html, text };
}

/**
 * Versendet die Booklet-Auslieferungs-E-Mail über Resend. Wirft bei fehlendem
 * Key (getResend) oder einem Resend-Fehler — der Aufrufer behandelt den Versand
 * NICHT-BLOCKIEREND (Auslieferung gilt trotzdem als erfolgt, 9c-1).
 */
export async function sendBookletEmail(
  params: BookletEmailParams,
): Promise<void> {
  const { to, customerName, businessName, bookletUrl, replyTo, websiteUrl } =
    params;
  const resend = getResend();

  const subject = `Ihr Booklet von ${businessName.trim() || "Ihrem Betrieb"}`;
  const { html, text } = renderBookletEmail({
    customerName,
    businessName,
    bookletUrl,
    websiteUrl,
  });

  const { error } = await resend.emails.send({
    from: `"${fromDisplayName(businessName)}" <${FROM_ADDRESS}>`,
    to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    throw new Error(`resend: ${error.message}`);
  }
}
