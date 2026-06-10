"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Bereits eingeloggt → direkt ins Portal.
  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/portal");
    });
  }, [router]);

  const handleSignIn = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(t(DEFAULT_LOCALE, "login.error"));
      setLoading(false);
      return;
    }

    router.replace("/portal");
    router.refresh();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void handleSignIn();
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
      <div className="card" style={{ width: "100%", maxWidth: 380 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700 }}>
          {t(DEFAULT_LOCALE, "login.title")}
        </h1>
        <hr className="divider-gold" />

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {t(DEFAULT_LOCALE, "login.email")}
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
              {t(DEFAULT_LOCALE, "login.password")}
            </span>
            <input
              type="password"
              autoComplete="current-password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            onClick={() => void handleSignIn()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") void handleSignIn();
            }}
          >
            {t(DEFAULT_LOCALE, "login.submit")}
          </div>
        </div>
      </div>
    </main>
  );
}
