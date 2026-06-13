import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import { bookletShareLink } from "@/lib/booklet/share-link";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";
import { QrPrintButton } from "./qr-print-button";

/* Pro Request frisch: der Booklet-Token ist datenabhängig, nichts cachen. */
export const dynamic = "force-dynamic";

/**
 * Öffentliche Booklet-Basis-URL für den QR-Link — identisch zur Auslieferungs-
 * E-Mail (9c-1): bevorzugt die explizite `BOOKLET_BASE_URL` (Prod ggf. eigene
 * Domain, z. B. `https://b.valooro.com`), sonst der Origin des aktuellen Requests
 * (dev: Portal + Booklet teilen sich den Host). Trailing-Slashes entfernt.
 */
function bookletBaseUrl(host: string, proto: string): string {
  const configured = process.env.BOOKLET_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${proto}://${host}`;
}

/**
 * QR-Druckansicht /portal/orders/[id]/qr (Schritt 9c-2) — Handover am Tresen.
 * Server Component, druckoptimiert (Bon-Drucker = schmal + S/W).
 *
 * Der QR kodiert den KUNDEN-Booklet-Link (`/b/[token]?c=1`, §9d-Marker), wird
 * SERVER-SEITIG als SVG erzeugt (scharf, kein Client-JS für den Code nötig) und
 * eingebettet. Schließt den No-E-Mail-Auslieferungspfad: scannen statt mailen.
 *
 * ISOLATION (RLS): AUTHENTICATED Client + getCurrentBusiness. Order + Booklet
 * werden über RLS geladen (fremde/fehlende ⇒ notFound). Guard: ein Booklet muss
 * existieren UND der Auftrag muss `generated` ODER `sent` sein — sonst notFound
 * (vor der Generierung gibt es keinen Link zum Drucken).
 */
export default async function QrPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Middleware schützt /portal/* bereits (kein User ⇒ /login); defensiv hier
  // ebenfalls: ohne aufgelösten Betrieb gibt es nichts zu zeigen.
  const business = await getCurrentBusiness();
  if (!business) notFound();

  const supabase = await createClient();

  // Order über RLS — fremde/fehlende id ⇒ notFound.
  const { data: order } = await supabase
    .from("orders")
    .select("id, customer_name, status")
    .eq("id", id)
    .maybeSingle<{ id: string; customer_name: string; status: string }>();
  if (!order) notFound();

  // Nur ein generiertes/ausgeliefertes Booklet hat einen druckbaren Link.
  if (order.status !== "generated" && order.status !== "sent") notFound();

  // Booklet (access_token) über RLS — Mitglieder dürfen booklets lesen.
  const { data: booklet } = await supabase
    .from("booklets")
    .select("access_token, short_code")
    .eq("order_id", order.id)
    .maybeSingle<{ access_token: string; short_code: string | null }>();
  if (!booklet) notFound();

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = bookletBaseUrl(host, proto);

  // KUNDEN-Link (Marker `?c=1`, §9d): der Empfänger sieht die volle Kunden-Sicht
  // inkl. Teilen-Sektion — wie der E-Mail-Link. Block C: kurzer Kurzlink (Fallback
  // auf den langen /b/-Link für alte Booklets ohne Code).
  const customerUrl = bookletShareLink({
    base,
    accessToken: booklet.access_token,
    shortCode: booklet.short_code,
    customerView: true,
  });

  // QR server-seitig als SVG. errorCorrectionLevel 'M' = robust gegen leichte
  // Druck-/Scan-Fehler; schwarz auf weiß (Thermodruck ist S/W).
  const qrSvg = await QRCode.toString(customerUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
    color: { dark: "#000000", light: "#ffffff" },
  });

  return (
    <div className="qr-page">
      {/* Bildschirm-only: Zurück-Weg zum Auftrag (Sackgassen-Fix) + Druck-
          Auslöser. `@media print` blendet die ganze Leiste aus. */}
      <div className="qr-no-print qr-actions">
        <Link className="btn-outline" href={`/portal/orders/${id}`}>
          ← {t(DEFAULT_LOCALE, "qr.back")}
        </Link>
        <QrPrintButton />
      </div>

      {/* Die einzige Sache, die druckt: schmale, S/W-taugliche Karte. */}
      <div className="qr-card">
        <div className="qr-card-business">{business.name}</div>
        <div className="qr-card-for">
          {t(DEFAULT_LOCALE, "qr.forCustomer", { name: order.customer_name })}
        </div>
        {/* Server-seitig erzeugtes, nicht nutzergesteuertes SVG (QRCode.toString). */}
        <div className="qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <p className="qr-card-hint">{t(DEFAULT_LOCALE, "qr.hint")}</p>
      </div>
    </div>
  );
}
