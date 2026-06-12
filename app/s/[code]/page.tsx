import { notFound, redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import {
  CUSTOMER_VIEW_QUERY,
  isCustomerViewParam,
} from "@/lib/booklet/customer-view";

/* Pro Request frisch: Lookup + Redirect, nichts cachen. */
export const dynamic = "force-dynamic";

/**
 * Kurzlink-Redirect /s/[code] (Block C). Öffentlich, KEINE Session.
 *
 * Schlägt `short_code` in booklets nach (service_role — öffentlich, kein
 * User-Kontext, analog zum öffentlichen /b/[token]-Read) und leitet 307 auf das
 * echte Booklet `/b/<access_token>` weiter. Liest NUR (kein Schreiben) und gibt
 * außer dem Redirect nichts preis.
 *
 * §9d: Der Kunden-Marker `?c=1` wird durchgereicht — ein markierter Kurzlink
 * (E-Mail/QR) landet in der Kunden-Sicht, ein nackter (vom Kunden geteilter)
 * Kurzlink in der Empfänger-Sicht. KEIN Auth-Gate: der `access_token` bleibt der
 * alleinige Zugriffsschutz (§14.2), der Code ist nur ein kurzer Lookup-Schlüssel.
 *
 * Nicht gefunden ⇒ notFound() (Next-404-Seite, kein Stacktrace). Diese Route
 * liegt NICHT unter /portal, der Middleware-Guard greift also nicht.
 */
export default async function ShortLinkRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  if (!code) notFound();

  const service = createServiceClient();
  const { data: booklet } = await service
    .from("booklets")
    .select("access_token")
    .eq("short_code", code)
    .maybeSingle<{ access_token: string }>();

  if (!booklet) notFound();

  // §9d-Marker durchreichen (nackt bleibt nackt, c=1 bleibt Kunden-Sicht).
  const customerView = isCustomerViewParam(await searchParams);
  redirect(
    `/b/${booklet.access_token}${customerView ? `?${CUSTOMER_VIEW_QUERY}` : ""}`,
  );
}
