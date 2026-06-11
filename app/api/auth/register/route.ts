import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendRegistrationNotification } from "@/lib/email/admin-notification";

/**
 * POST /api/auth/register — Self-Service-Registrierung (Option C, pending).
 *
 * Liegt bewusst NICHT unter /portal: der Endpoint ist öffentlich (es gibt noch
 * keine Session bzw. die Session ist pending). Schreibt über `service_role`
 * (RLS umgangen) — die Tabellen haben für `anon`/`authenticated` ohnehin kein
 * passendes INSERT-Grant für eine fremde/neue business_id.
 *
 * Ablauf (nach erfolgreichem `supabase.auth.signUp` im Client):
 *  1. Validierung (businessName/email/userId vorhanden, name ≤ 100) ⇒ sonst 400.
 *  2. business_email bereits vergeben ⇒ 409 `email_taken`.
 *  3. Insert businesses { name, business_email, slug, status:'pending', default_language:'de' }.
 *  4. Insert business_users { business_id, user_id, role:'owner' }.
 *     - user_id ist per FK an auth.users gebunden: ein erfundener userId scheitert
 *       hier ⇒ wir rollen den businesses-Insert zurück (kein verwaister Betrieb,
 *       der die E-Mail dauerhaft mit 409 blockieren würde).
 *  5. Admin-Benachrichtigung per Resend (NON-FATAL).
 *
 * Status startet auf 'pending' ⇒ das Portal bleibt gesperrt (getCurrentBusiness
 * redirect /pending), bis ein Admin manuell freischaltet.
 */

const MAX_NAME_LENGTH = 100;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Echte Fehlermeldung für die Server-Logs (Vercel) extrahieren. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Slug aus dem Betriebsnamen: lowercase, nicht-alphanumerisch → `-`, auf 50
 * Zeichen gekürzt, plus zufällige 4-stellige Zahl gegen Kollisionen. Der leere
 * Fall (nur Sonderzeichen) fällt auf "betrieb" zurück.
 */
function buildSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base || "betrieb"}-${suffix}`;
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const body =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const businessName =
    typeof body.businessName === "string" ? body.businessName.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";

  if (!businessName || !email || !userId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (businessName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }
  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const service = createServiceClient();

  // 1. business_email bereits vergeben?
  const { data: existing, error: lookupError } = await service
    .from("businesses")
    .select("id")
    .eq("business_email", email)
    .maybeSingle<{ id: string }>();
  if (lookupError) {
    console.error("register: business lookup failed", {
      step: "lookup",
      message: lookupError.message,
    });
    return NextResponse.json({ error: "registration_failed" }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  // 2. Betrieb anlegen (Status pending).
  const { data: inserted, error: insertError } = await service
    .from("businesses")
    .insert({
      name: businessName,
      business_email: email,
      slug: buildSlug(businessName),
      status: "pending",
      default_language: "de",
    })
    .select("id")
    .single<{ id: string }>();
  if (insertError || !inserted) {
    // 23505 = unique_violation (business_email-Race oder seltene Slug-Kollision).
    if (insertError?.code === "23505") {
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }
    console.error("register: business insert failed", {
      step: "insert_business",
      message: insertError?.message ?? "no row returned",
    });
    return NextResponse.json({ error: "registration_failed" }, { status: 500 });
  }

  // 3. Mitgliedschaft anlegen (owner). user_id ist per FK an auth.users gebunden.
  const { error: memberError } = await service.from("business_users").insert({
    business_id: inserted.id,
    user_id: userId,
    role: "owner",
  });
  if (memberError) {
    // Rollback: sonst bleibt ein verwaister Betrieb zurück, der die E-Mail
    // dauerhaft mit 409 blockiert.
    const { error: rollbackError } = await service
      .from("businesses")
      .delete()
      .eq("id", inserted.id);
    if (rollbackError) {
      console.error("register: rollback failed", {
        step: "rollback_business",
        business_id: inserted.id,
        message: rollbackError.message,
      });
    }
    console.error("register: membership insert failed", {
      step: "insert_membership",
      business_id: inserted.id,
      message: memberError.message,
    });
    return NextResponse.json({ error: "registration_failed" }, { status: 500 });
  }

  // 4. Admin-Benachrichtigung (NON-FATAL) — die Registrierung steht bereits.
  try {
    await sendRegistrationNotification({ businessName, email });
  } catch (error) {
    console.error("register: admin notification failed", {
      step: "admin_email",
      business_id: inserted.id,
      message: errMessage(error),
    });
  }

  return NextResponse.json({ ok: true });
}
