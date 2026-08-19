"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { DuesPaymentMethod } from "@prisma/client";
import { buildPayLink, getPayLinkHostname, getPaymentMethodCategory } from "@/lib/payment-method-links";
import { calculateProcessingCostCoverageCents } from "@/lib/giving/coverage-math";

type PayMethod = {
  id: string;
  method: DuesPaymentMethod;
  label: string;
  instructions: string | null;
  accountIdentifier: string | null;
};

/** FEE-COVER-C: display-only — the server re-quotes at checkout. */
type CoverageOffer = { offered: boolean; percentBps: number; fixedCents: number };

type Props = {
  slug: string;
  fixedAmount: number | null;
  minAmount: number;
  methods: PayMethod[];
  coverage?: CoverageOffer;
};

const fieldClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export function PublicPaymentForm({ slug, fixedAmount, minAmount, methods, coverage }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(methods[0]?.id ?? null);
  const selected = methods.find((m) => m.id === selectedId) ?? null;
  const category = selected ? getPaymentMethodCategory(selected.method) : null;

  if (methods.length === 0) {
    return (
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-6 text-center text-sm text-yellow-800">
        This payment link has no active payment methods configured.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {methods.length > 1 && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment method">
          {methods.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === selectedId}
              onClick={() => setSelectedId(m.id)}
              className={`rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${
                m.id === selectedId
                  ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {selected && category === "native" && (
        <StripeCheckoutSection slug={slug} fixedAmount={fixedAmount} minAmount={minAmount} coverage={coverage} />
      )}

      {selected && category === "external" && <ExternalRedirectSection method={selected} />}

      {selected && category === "offline" && (
        <OfflineInstructionsSection slug={slug} method={selected} fixedAmount={fixedAmount} minAmount={minAmount} />
      )}
    </div>
  );
}

function StripeCheckoutSection({
  slug,
  fixedAmount,
  minAmount,
  coverage = { offered: false, percentBps: 0, fixedCents: 0 },
}: {
  slug: string;
  fixedAmount: number | null;
  minAmount: number;
  coverage?: CoverageOffer;
}) {
  const [amount, setAmount] = useState(fixedAmount ? fixedAmount.toFixed(2) : "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // FEE-COVER-C: voluntary and defaults OFF — never silently pre-added.
  const [coverProcessingCosts, setCoverProcessingCosts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveAmount = fixedAmount ?? Number(amount);
  const baseCents = Number.isNaN(effectiveAmount) ? 0 : Math.round(effectiveAmount * 100);
  const estimateCents =
    coverage.offered && baseCents > 0
      ? calculateProcessingCostCoverageCents(baseCents, coverage.percentBps, coverage.fixedCents)
      : 0;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const parsedAmount = fixedAmount ?? Number(amount);
    if (!fixedAmount && (Number.isNaN(parsedAmount) || parsedAmount < minAmount)) {
      setError(`Please enter an amount of at least $${minAmount.toFixed(2)}.`);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/pay/${slug}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parsedAmount,
          contributorName: name.trim() || undefined,
          contributorEmail: email.trim() || undefined,
          coverProcessingCosts: coverage.offered && coverProcessingCosts ? true : undefined,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; url?: string; error?: string }
        | null;

      if (!response.ok || !payload?.ok || !payload.url) {
        setError(payload?.error ?? "Unable to start checkout. Please try again.");
        return;
      }

      window.location.href = payload.url;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {fixedAmount ? (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-center">
          <p className="text-sm text-slate-600">Amount</p>
          <p className="text-3xl font-bold text-emerald-700">${fixedAmount.toFixed(2)}</p>
        </div>
      ) : (
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Amount (USD) <span className="text-red-600">*</span></span>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">$</span>
            <input
              required
              type="number"
              min={minAmount}
              step="0.01"
              className={`${fieldClassName} pl-7`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`${minAmount.toFixed(2)}`}
            />
          </div>
        </label>
      )}

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Your name <span className="text-slate-400 font-normal">(optional)</span></span>
        <input
          type="text"
          className={fieldClassName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Smith"
        />
      </label>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Email for receipt <span className="text-slate-400 font-normal">(optional)</span></span>
        <input
          type="email"
          className={fieldClassName}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="jane@example.com"
        />
      </label>

      {coverage.offered && baseCents > 0 ? (
        <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={coverProcessingCosts}
            onChange={(e) => setCoverProcessingCosts(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Help cover estimated processing costs{" "}
            <span className="font-semibold">(+${(estimateCents / 100).toFixed(2)})</span>, so the full $
            {(baseCents / 100).toFixed(2)} goes to the organization.
          </span>
        </label>
      ) : null}

      {coverage.offered && coverProcessingCosts && baseCents > 0 ? (
        <div className="rounded-lg bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-800">
          Total: <span className="font-semibold">${((baseCents + estimateCents) / 100).toFixed(2)}</span>
        </div>
      ) : null}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-emerald-700 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {loading ? "Redirecting to Stripe..." : "Pay now"}
      </button>
    </form>
  );
}

function ExternalRedirectSection({ method }: { method: PayMethod }) {
  const payLink = method.accountIdentifier ? buildPayLink(method.method, method.accountIdentifier) : null;
  const hostname = payLink ? getPayLinkHostname(payLink) : null;

  if (!payLink) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        This payment method isn&apos;t set up correctly. Please contact the organization directly.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {method.instructions && <p className="text-sm text-slate-700">{method.instructions}</p>}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        You&apos;re about to leave Unestra to pay via {method.label}
        {hostname ? ` at ${hostname}` : ""}. Unestra can&apos;t confirm this payment automatically.
      </div>
      <a
        href={payLink}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full rounded-lg bg-emerald-700 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-800"
      >
        Continue to {method.label}
      </a>
    </div>
  );
}

function OfflineInstructionsSection({
  slug,
  method,
  fixedAmount,
  minAmount,
}: {
  slug: string;
  method: PayMethod;
  fixedAmount: number | null;
  minAmount: number;
}) {
  const [showReportForm, setShowReportForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [amount, setAmount] = useState(fixedAmount ? fixedAmount.toFixed(2) : "");
  const [payerName, setPayerName] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = useMemo(() => fixedAmount ?? Number(amount), [fixedAmount, amount]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (Number.isNaN(parsedAmount) || parsedAmount < minAmount) {
      setError(`Please enter an amount of at least $${minAmount.toFixed(2)}.`);
      return;
    }
    if (!payerName.trim() || !payerEmail.trim()) {
      setError("Please enter your name and email.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/pay/${slug}/offline-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethodConfigId: method.id,
          payerName: payerName.trim(),
          payerEmail: payerEmail.trim(),
          amount: parsedAmount,
          referenceNumber: referenceNumber.trim() || undefined,
          message: message.trim() || undefined,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to submit your report. Please try again.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
        Thanks! Your reported payment has been submitted for review. This is not a receipt — the organization
        will confirm it once reviewed.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {method.accountIdentifier && <p className="font-semibold text-slate-900">{method.accountIdentifier}</p>}
      {method.instructions && <p className="text-sm text-slate-700">{method.instructions}</p>}

      {!showReportForm ? (
        <button
          type="button"
          onClick={() => setShowReportForm(true)}
          className="w-full rounded-lg border border-emerald-600 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
        >
          I&apos;ve made this payment
        </button>
      ) : (
        <form className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4" onSubmit={handleSubmit}>
          <p className="text-xs text-slate-500">
            Let the organization know so they can confirm it. This is a submission for review, not a receipt.
          </p>

          {!fixedAmount && (
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Amount (USD)</span>
              <input
                required
                type="number"
                min={minAmount}
                step="0.01"
                className={fieldClassName}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          )}

          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Your name</span>
            <input
              required
              type="text"
              className={fieldClassName}
              value={payerName}
              onChange={(e) => setPayerName(e.target.value)}
            />
          </label>

          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Your email</span>
            <input
              required
              type="email"
              className={fieldClassName}
              value={payerEmail}
              onChange={(e) => setPayerEmail(e.target.value)}
            />
          </label>

          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Reference number <span className="text-slate-400 font-normal">(optional)</span></span>
            <input
              type="text"
              className={fieldClassName}
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
            />
          </label>

          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Note <span className="text-slate-400 font-normal">(optional)</span></span>
            <textarea
              className={fieldClassName}
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-700 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading ? "Submitting..." : "Submit for review"}
          </button>
        </form>
      )}
    </div>
  );
}
