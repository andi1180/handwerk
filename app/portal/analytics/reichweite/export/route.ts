import { createClient } from "@/lib/supabase/server";
import { getCurrentBusiness } from "@/lib/auth/current-business";
import {
  DEFAULT_REACH_SORT,
  formatReachDate,
  isReachSort,
  loadReachRows,
  parseDateParam,
  type ReachRow,
} from "@/lib/analytics/reach";

/**
 * GET /portal/analytics/reichweite/export — CSV-Export der Reichweiten-/VIP-
 * Analyse (volle gefilterte + sortierte Liste, NICHT nur die Top 10 der Seite).
 *
 * AUTHENTICATED Server-Client (RLS-skopiert) + defensiver `business_id`-Filter
 * über `loadReachRows`; KEIN service_role, business_id NUR aus der Session.
 * Honoriert `?from=`/`?to=`/`?sort=` wie die Seite (geteilte Aggregation).
 *
 * Ausgabe für österreichisches Excel: text/csv; charset=utf-8, **UTF-8-BOM**
 * vorangestellt (Umlaute korrekt), **Semikolon**-getrennt (Spalten korrekt),
 * CRLF-Zeilenenden, deutsche Header. Der Export enthält Name + E-Mail + Telefon
 * (eigene Kundendaten des Betriebs, DSGVO-konform) — kein zusätzliches Gate nötig.
 */
export const runtime = "nodejs";

/** Spaltenüberschriften (deutsch) in der vorgegebenen Reihenfolge. */
const CSV_HEADER = [
  "Kundenname",
  "E-Mail",
  "Telefon",
  "roapp-Nr.",
  "Beschreibung",
  "Booklet-Versanddatum",
  "Reichweite (eindeutig)",
  "Gesamt-Öffnungen",
  "Teilen-Aktivitäten",
];

/**
 * Quotet ein CSV-Feld: enthält es `;`, `"` oder einen Zeilenumbruch, wird es in
 * `"…"` gesetzt und interne `"` verdoppelt (RFC-4180-Stil). null ⇒ leer.
 */
function csvField(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Baut den CSV-Body (Semikolon-getrennt, CRLF). */
function buildCsv(rows: ReachRow[]): string {
  const lines = [CSV_HEADER.map(csvField).join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.customerName,
        r.email,
        r.phone,
        r.externalRef,
        r.description,
        formatReachDate(r.sentAt),
        r.reach,
        r.opens,
        r.shares,
      ]
        .map(csvField)
        .join(";"),
    );
  }
  return lines.join("\r\n");
}

export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("unauthorized", { status: 401 });
  }

  const business = await getCurrentBusiness();
  if (!business) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const from = parseDateParam(url.searchParams.get("from"));
  const to = parseDateParam(url.searchParams.get("to"));
  const sortParam = url.searchParams.get("sort");
  const sort = isReachSort(sortParam) ? sortParam : DEFAULT_REACH_SORT;

  const rows = await loadReachRows(supabase, business.id, { from, to, sort });

  // UTF-8-BOM (U+FEFF) voranstellen, damit österreichisches Excel die Umlaute erkennt.
  const body = `﻿${buildCsv(rows)}`;
  const filename = `reichweite_${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
