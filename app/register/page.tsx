"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

const MIN_PASSWORD = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Self-Service-Registrierung (Option C, pending). Client Component, kein
 * `<form>` — Absenden via `div + onClick`, Styling wie /login.
 *
 * Ablauf: `supabase.auth.signUp` (Auth-User) → POST /api/auth/register (Betrieb
 * + Mitgliedschaft, Status pending). Kein Auto-Login, kein Redirect ins Portal —
 * stattdessen eine Erfolgsmeldung (Freischaltung erfolgt manuell).
 */
export default function RegisterPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Bereits eingeloggt → ins Portal (aktive Betriebe) bzw. /pending (Layout/Guard).
  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/portal");
    });
  }, [router]);

  const handleRegister = async () => {
    if (loading) return;
    setError(null);

    const name = businessName.trim();
    const mail = email.trim();
    if (!name || !mail || !password || !passwordRepeat) {
      setError(t(DEFAULT_LOCALE, "register.fieldsRequired"));
      return;
    }
    if (!EMAIL_REGEX.test(mail)) {
      setError(t(DEFAULT_LOCALE, "register.emailInvalid"));
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(t(DEFAULT_LOCALE, "register.passwordMin", { min: MIN_PASSWORD }));
      return;
    }
    if (password !== passwordRepeat) {
      setError(t(DEFAULT_LOCALE, "register.passwordMismatch"));
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // 1. Auth-User anlegen.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: mail,
      password,
    });
    if (signUpError || !data.user) {
      // Bei aktivierter E-Mail-Bestätigung meldet signUp Duplikate aus
      // Anti-Enumeration NICHT als Fehler — diese werden vom Route Handler (409)
      // abgefangen. Hier nur die direkten signUp-Fehler behandeln.
      const message = signUpError?.message ?? "";
      const key = /registered|exists|taken/i.test(message)
        ? "register.emailTaken"
        : "register.error";
      setError(t(DEFAULT_LOCALE, key));
      setLoading(false);
      return;
    }

    // 2. Betrieb + Mitgliedschaft anlegen (Status pending).
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: name,
          email: mail,
          userId: data.user.id,
        }),
      });
      if (!res.ok) {
        const key =
          res.status === 409 ? "register.emailTaken" : "register.error";
        setError(t(DEFAULT_LOCALE, key));
        setLoading(false);
        return;
      }
    } catch {
      setError(t(DEFAULT_LOCALE, "register.error"));
      setLoading(false);
      return;
    }

    setLoading(false);
    setDone(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void handleRegister();
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 400 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700 }}>
          {t(DEFAULT_LOCALE, "register.title")}
        </h1>
        <hr className="divider-gold" />

        {done ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>
              {t(DEFAULT_LOCALE, "register.success")}
            </p>
            <Link
              href="/login"
              className="btn-dark"
              style={{ width: "100%", textAlign: "center", marginTop: 4 }}
            >
              {t(DEFAULT_LOCALE, "register.loginLink")}
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p
              style={{
                margin: "0 0 2px",
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--text-secondary)",
              }}
            >
              {t(DEFAULT_LOCALE, "register.intro")}
            </p>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {t(DEFAULT_LOCALE, "register.businessName")}
              </span>
              <input
                type="text"
                autoComplete="organization"
                className="form-input"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {t(DEFAULT_LOCALE, "register.email")}
              </span>
              <input
                type="email"
                autoComplete="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {t(DEFAULT_LOCALE, "register.password")}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {t(DEFAULT_LOCALE, "register.passwordRepeat")}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                className="form-input"
                value={passwordRepeat}
                onChange={(e) => setPasswordRepeat(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </label>

            {error ? (
              <p style={{ margin: 0, fontSize: 13, color: "#B23B3B" }}>{error}</p>
            ) : null}

            <div
              role="button"
              tabIndex={0}
              aria-disabled={loading}
              className="btn-dark"
              style={{
                width: "100%",
                marginTop: 4,
                opacity: loading ? 0.7 : 1,
                pointerEvents: loading ? "none" : "auto",
              }}
              onClick={() => void handleRegister()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") void handleRegister();
              }}
            >
              {loading
                ? t(DEFAULT_LOCALE, "register.submitting")
                : t(DEFAULT_LOCALE, "register.submit")}
            </div>

            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                textAlign: "center",
                color: "var(--text-secondary)",
              }}
            >
              {t(DEFAULT_LOCALE, "register.alreadyRegistered")}{" "}
              <Link href="/login" style={{ color: "var(--gold)" }}>
                {t(DEFAULT_LOCALE, "register.loginLink")}
              </Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
