"use client";

import { FormEvent, useEffect, useState } from "react";

type ProductCode =
  | "essential_annual"
  | "elite_annual"
  | "essential_perpetual"
  | "elite_perpetual"
  | "annual_renewal"
  | "maintenance_renewal";

type RenewalPlan = "Essential" | "Elite";

const products: Array<{
  code: ProductCode;
  title: string;
  description: string;
}> = [
  { code: "essential_annual", title: "Essential Annual", description: "Annual subscription for the Essential plan." },
  { code: "elite_annual", title: "Elite Annual", description: "Annual subscription for the Elite plan." },
  { code: "essential_perpetual", title: "Essential Perpetual", description: "Perpetual Essential license with one year of maintenance." },
  { code: "elite_perpetual", title: "Elite Perpetual", description: "Perpetual Elite license with one year of maintenance." },
  { code: "maintenance_renewal", title: "Maintenance Renewal", description: "Renew maintenance for an existing perpetual license." },
  { code: "annual_renewal", title: "Annual Renewal", description: "Renew an existing annual license without changing the key." },
];

function isRenewal(productCode: ProductCode) {
  return productCode === "annual_renewal" || productCode === "maintenance_renewal";
}

export default function BuyPage() {
  const [productCode, setProductCode] = useState<ProductCode>("essential_annual");
  const [customerEmail, setCustomerEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [targetLicenseKey, setTargetLicenseKey] = useState("");
  const [renewalPlan, setRenewalPlan] = useState<RenewalPlan>("Essential");
  const [environment, setEnvironment] = useState<"test" | "prod">("test");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const status = searchParams.get("status");
    if (status === "success") {
      setStatusMessage("Stripe returned to the buy page. Your checkout completed or is awaiting webhook confirmation.");
      return;
    }
    if (status === "cancelled") {
      setStatusMessage("Checkout was cancelled before payment completed.");
      return;
    }
    setStatusMessage(null);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const origin = window.location.origin;
      const response = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCode,
          customerEmail,
          organizationName,
          targetLicenseKey: isRenewal(productCode) ? targetLicenseKey : null,
          renewalPlan: isRenewal(productCode) ? renewalPlan : null,
          environment,
          successUrl: `${origin}/buy?status=success`,
          cancelUrl: `${origin}/buy?status=cancelled`,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.checkoutUrl) {
        throw new Error(payload?.error || `Checkout request failed (${response.status}).`);
      }

      window.location.assign(String(payload.checkoutUrl));
    } catch (submitError) {
      setError(String((submitError as Error)?.message || "Checkout request failed."));
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f5f7ef 0%, #eef2e5 45%, #e3ebda 100%)",
        color: "#203022",
        padding: "48px 20px 72px",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <p style={{ margin: 0, letterSpacing: "0.08em", textTransform: "uppercase", color: "#45604b", fontSize: 12 }}>
            CivicFlow Software Purchase
          </p>
          <h1 style={{ margin: "8px 0 10px", fontSize: "2.5rem", lineHeight: 1.05 }}>Buy or renew a CivicFlow license</h1>
          <p style={{ margin: 0, maxWidth: 720, color: "#506355", fontSize: 16 }}>
            Pick the product, enter billing details, and we&apos;ll create a Stripe checkout session using the current CivicFlow licensing backend.
          </p>
        </div>

        {statusMessage ? (
          <div style={{ marginBottom: 18, padding: 14, borderRadius: 14, background: "#eef4ff", border: "1px solid #cdd9ff" }}>
            {statusMessage}
          </div>
        ) : null}

        {error ? (
          <div style={{ marginBottom: 18, padding: 14, borderRadius: 14, background: "#fff0ed", border: "1px solid #f0c3b9", color: "#9b2f22" }}>
            {error}
          </div>
        ) : null}

        <form
          onSubmit={onSubmit}
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            alignItems: "start",
          }}
        >
          <section
            style={{
              background: "#ffffff",
              borderRadius: 20,
              border: "1px solid #d8e0cf",
              padding: 22,
              boxShadow: "0 18px 42px rgba(39, 63, 43, 0.08)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Product options</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {products.map((product) => {
                const selected = product.code === productCode;
                return (
                  <label
                    key={product.code}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "24px 1fr",
                      gap: 12,
                      padding: 14,
                      borderRadius: 16,
                      border: selected ? "1px solid #1f7a5a" : "1px solid #d8e0cf",
                      background: selected ? "#edf7f1" : "#fafcf7",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="productCode"
                      value={product.code}
                      checked={selected}
                      onChange={() => setProductCode(product.code)}
                      style={{ marginTop: 4 }}
                    />
                    <span>
                      <strong style={{ display: "block", marginBottom: 4 }}>{product.title}</strong>
                      <span style={{ color: "#506355", fontSize: 14 }}>{product.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <section
            style={{
              background: "#ffffff",
              borderRadius: 20,
              border: "1px solid #d8e0cf",
              padding: 22,
              boxShadow: "0 18px 42px rgba(39, 63, 43, 0.08)",
              display: "grid",
              gap: 14,
            }}
          >
            <h2 style={{ marginTop: 0 }}>Checkout details</h2>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#4b5f4f", fontSize: 14 }}>Customer email</span>
              <input
                type="email"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
                required
                style={{ padding: "11px 12px", borderRadius: 12, border: "1px solid #ccd8c0" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#4b5f4f", fontSize: 14 }}>Organization name</span>
              <input
                type="text"
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                required
                style={{ padding: "11px 12px", borderRadius: 12, border: "1px solid #ccd8c0" }}
              />
            </label>

            {isRenewal(productCode) ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "#4b5f4f", fontSize: 14 }}>Existing license key</span>
                  <input
                    type="text"
                    value={targetLicenseKey}
                    onChange={(event) => setTargetLicenseKey(event.target.value.toUpperCase())}
                    placeholder="CF-XXXX-XXXX-XXXX-XXXX"
                    required
                    style={{ padding: "11px 12px", borderRadius: 12, border: "1px solid #ccd8c0" }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "#4b5f4f", fontSize: 14 }}>Renewal tier</span>
                  <select
                    value={renewalPlan}
                    onChange={(event) => setRenewalPlan(event.target.value as RenewalPlan)}
                    style={{ padding: "11px 12px", borderRadius: 12, border: "1px solid #ccd8c0" }}
                  >
                    <option value="Essential">Essential</option>
                    <option value="Elite">Elite</option>
                  </select>
                </label>
              </>
            ) : null}

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#4b5f4f", fontSize: 14 }}>Environment</span>
              <select
                value={environment}
                onChange={(event) => setEnvironment(event.target.value === "prod" ? "prod" : "test")}
                style={{ padding: "11px 12px", borderRadius: 12, border: "1px solid #ccd8c0" }}
              >
                <option value="test">Test</option>
                <option value="prod">Prod</option>
              </select>
            </label>

            <button
              type="submit"
              disabled={submitting}
              style={{
                marginTop: 8,
                padding: "12px 16px",
                borderRadius: 999,
                border: "none",
                background: submitting ? "#8db8a1" : "#1f7a5a",
                color: "#fff",
                fontWeight: 700,
                cursor: submitting ? "wait" : "pointer",
              }}
            >
              {submitting ? "Redirecting to checkout..." : "Continue to Stripe Checkout"}
            </button>
          </section>
        </form>
      </div>
    </main>
  );
}
