"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, t } from "@/lib/i18n";

/**
 * Anlage-Formular für einen Auftrag (einzige Client Component dieser Route).
 * Kein `<form>`-Tag — Absenden über `div + onClick`. ISOLATION: es wird KEINE
 * `business_id` mitgeschickt; der Route Handler leitet sie serverseitig aus der
 * Session ab. Mobile-first, einspaltig, große Tap-Targets.
 *
 * ⚠️ KEINE Einwilligungs-Checkbox mehr: Die Einwilligung wird an der Kassa bei
 *    jedem Stück eingeholt, der Route Handler setzt sie deshalb automatisch.
 */
export default function NewOrderForm() {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (submitting) return;
    if (customerName.trim().length === 0) {
      setError(t(DEFAULT_LOCALE, "orders.nameRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/portal/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          external_ref: externalRef,
          item_description: itemDescription,
        }),
      });

      if (!res.ok) {
        setError(t(DEFAULT_LOCALE, "orders.createError"));
        setSubmitting(false);
        return;
      }

      router.push("/portal/orders");
      router.refresh();
    } catch {
      setError(t(DEFAULT_LOCALE, "orders.createError"));
      setSubmitting(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };
  const captionStyle: React.CSSProperties = {
    fontSize: 13,
    color: "var(--text-secondary)",
  };
  const hintStyle: React.CSSProperties = {
    fontSize: 12,
    color: "var(--text-secondary)",
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 700 }}>
        {t(DEFAULT_LOCALE, "orders.new")}
      </h1>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={labelStyle}>
          <span style={captionStyle}>
            {t(DEFAULT_LOCALE, "orders.customerName")}
          </span>
          <input
            type="text"
            className="form-input"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </label>

        <label style={labelStyle}>
          <span style={captionStyle}>{t(DEFAULT_LOCALE, "orders.email")}</span>
          <input
            type="email"
            autoComplete="off"
            className="form-input"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
          />
        </label>

        <label style={labelStyle}>
          <span style={captionStyle}>{t(DEFAULT_LOCALE, "orders.phone")}</span>
          <input
            type="tel"
            autoComplete="off"
            className="form-input"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
          />
        </label>

        <label style={labelStyle}>
          <span style={captionStyle}>
            {t(DEFAULT_LOCALE, "orders.externalRef")}
          </span>
          <input
            type="text"
            className="form-input"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
          />
          <span style={hintStyle}>
            {t(DEFAULT_LOCALE, "orders.externalRefHint")}
          </span>
        </label>

        <label style={labelStyle}>
          <span style={captionStyle}>
            {t(DEFAULT_LOCALE, "orders.itemDescription")}
          </span>
          <textarea
            className="form-input"
            rows={4}
            style={{ resize: "vertical", minHeight: 96 }}
            value={itemDescription}
            onChange={(e) => setItemDescription(e.target.value)}
          />
          <span style={hintStyle}>
            {t(DEFAULT_LOCALE, "orders.itemDescriptionHint")}
          </span>
        </label>

        {error ? (
          <p style={{ margin: 0, fontSize: 13, color: "#B23B3B" }}>{error}</p>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            role="button"
            tabIndex={0}
            aria-disabled={submitting}
            className="btn-dark"
            style={{
              flex: 1,
              opacity: submitting ? 0.7 : 1,
              pointerEvents: submitting ? "none" : "auto",
            }}
            onClick={() => void handleCreate()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") void handleCreate();
            }}
          >
            {t(DEFAULT_LOCALE, "orders.create")}
          </div>
          <Link href="/portal/orders" className="btn-outline">
            {t(DEFAULT_LOCALE, "orders.title")}
          </Link>
        </div>
      </div>
    </div>
  );
}
