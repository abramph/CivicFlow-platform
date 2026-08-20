"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * LAUNCH-SAFE §1 — the organization payment-cost policy page. Shows ONLY
 * supported launch choices:
 *  - fixed obligations: organization absorbs card costs (informational —
 *    REQUIRED_WHERE_PERMITTED is dormant platform capability and is never
 *    presented as available);
 *  - voluntary giving: optional coverage (default) or organization absorbs;
 *  - fixed-obligation payment preference: card+absorb / prefer ACH /
 *    require ACH (ACH options locked until ACH is enabled and verified).
 * All writes go through /api/payments/cost-policy, which enforces the same
 * rules server-side — this page is presentation, not authority.
 */

export interface PaymentCostPolicySettings {
  paymentCostPolicyV2Enabled: boolean;
  fixedObligationCoveragePolicy: string;
  voluntaryCoveragePolicy: string;
  fixedObligationPaymentPreference: string;
  achEnabled: boolean;
  policyAcceptedAt: string | null;
  policyVersion: string | null;
  currentPolicyVersion: string;
}

export function PaymentCostPolicyManager({
  settings,
  canManage,
}: {
  settings: PaymentCostPolicySettings;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(update: Record<string, unknown>, successNotice: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/payments/cost-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to save. Please try again.");
        return;
      }
      setNotice(successNotice);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const acknowledged = Boolean(settings.policyAcceptedAt);

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

      {/* ── Fixed obligations ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Online dues and required payments</h3>
        <p className="mt-2 text-sm text-slate-700">
          The organization currently absorbs card-processing costs. Members are credited the full amount they pay
          toward their obligation.
        </p>
        <p className="mt-1 text-sm text-slate-700">Use ACH when available to reduce processing costs.</p>
        <p className="mt-3 text-xs text-slate-500">
          Passing card costs to payers on required payments needs an eligibility-aware capability (credit vs.
          debit/prepaid detection) that is not yet available on this platform. It cannot be enabled here.
        </p>
      </section>

      {/* ── Voluntary payments ────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Voluntary giving and donations</h3>
        <div className="mt-3 space-y-3">
          {[
            {
              value: "OPTIONAL",
              label: "Offer optional processing-cost coverage",
              consequence:
                "Donors see an unchecked “Help cover estimated processing costs” option. If they choose it, their gift plus the estimated cost is charged, and the full gift amount goes to your funds.",
            },
            {
              value: "ORGANIZATION_ABSORBS",
              label: "Organization absorbs processing costs",
              consequence: "Donors are charged exactly their gift amount; the option is not shown.",
            },
          ].map((option) => (
            <label key={option.value} className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="voluntaryCoveragePolicy"
                className="mt-1"
                disabled={!canManage || busy}
                checked={settings.voluntaryCoveragePolicy === option.value}
                onChange={() => save({ voluntaryCoveragePolicy: option.value }, "Voluntary giving policy saved.")}
              />
              <span>
                <span className="font-medium text-slate-900">{option.label}</span>
                <span className="mt-0.5 block text-slate-600">{option.consequence}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* ── Payment preference for fixed obligations ──────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">How members pay dues and required payments online</h3>
        {!settings.achEnabled ? (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Bank transfer (ACH) is not yet enabled and verified for this organization, so the ACH options below are
            locked. Card payments work today, with processing costs absorbed by the organization.
          </p>
        ) : null}
        <div className="mt-3 space-y-3">
          {[
            {
              value: "CARD_AND_ABSORB",
              label: "Accept card and absorb processing costs",
              consequence: "Members pay by card; the organization pays the card-processing cost; members are credited in full.",
              needsAch: false,
            },
            {
              value: "PREFER_ACH",
              label: "Prefer ACH, but allow card",
              consequence:
                "Bank transfer is shown first with a note that it helps the organization reduce processing costs. Card remains available.",
              needsAch: true,
            },
            {
              value: "REQUIRE_ACH",
              label: "Require ACH for online fixed obligations",
              consequence:
                "Online dues and required payments use bank transfer only. If ACH ever becomes unavailable, checkout automatically falls back to card with the organization absorbing the cost — members are never blocked or marked behind.",
              needsAch: true,
            },
          ].map((option) => {
            const locked = option.needsAch && !settings.achEnabled;
            return (
              <label key={option.value} className={`flex items-start gap-3 text-sm ${locked ? "opacity-50" : ""}`}>
                <input
                  type="radio"
                  name="fixedObligationPaymentPreference"
                  className="mt-1"
                  disabled={!canManage || busy || locked}
                  checked={settings.fixedObligationPaymentPreference === option.value}
                  onChange={() =>
                    save({ fixedObligationPaymentPreference: option.value }, "Payment preference saved.")
                  }
                />
                <span>
                  <span className="font-medium text-slate-900">{option.label}</span>
                  <span className="mt-0.5 block text-slate-600">{option.consequence}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── Policy acknowledgment ─────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Payment-cost policy acknowledgment</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Your organization is the merchant receiving these payments through its own connected Stripe account.</li>
          <li>At launch, card-processing costs on dues and required payments are absorbed by your organization.</li>
          <li>Voluntary giving may offer donors an optional processing-cost contribution — never a required fee.</li>
          <li>Card-network and jurisdiction rules restrict passing costs to payers (debit and prepaid cards especially); Unestra will prevent configurations that cannot be applied compliantly.</li>
          <li>Your organization is responsible for choosing a lawful policy for its own circumstances.</li>
        </ul>
        {acknowledged ? (
          <p className="mt-3 text-xs text-emerald-700">
            Acknowledged{settings.policyVersion ? ` (policy ${settings.policyVersion})` : ""}.
          </p>
        ) : (
          <button
            type="button"
            disabled={!canManage || busy}
            onClick={() => save({ acceptPolicy: true }, "Policy acknowledged.")}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            I understand and accept
          </button>
        )}
      </section>

      {/* ── v2 activation ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Policy engine</h3>
        <p className="mt-2 text-sm text-slate-600">
          {settings.paymentCostPolicyV2Enabled
            ? "The payment-cost policy above is active for this organization's checkouts."
            : "This organization currently uses the original processing-cost settings from the Giving page. Activating the policy engine applies the choices above (dues checkouts stop offering the optional coverage checkbox — the organization absorbs card costs on obligations instead)."}
        </p>
        <button
          type="button"
          disabled={!canManage || busy}
          onClick={() =>
            save(
              { paymentCostPolicyV2Enabled: !settings.paymentCostPolicyV2Enabled },
              settings.paymentCostPolicyV2Enabled ? "Policy engine deactivated." : "Policy engine activated."
            )
          }
          className="mt-3 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {settings.paymentCostPolicyV2Enabled ? "Deactivate" : "Activate"}
        </button>
      </section>
    </div>
  );
}
