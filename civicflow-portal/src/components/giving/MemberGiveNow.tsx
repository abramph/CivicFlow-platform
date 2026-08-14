"use client";

import { useState } from "react";

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

interface FundView {
  id: string;
  name: string;
  description: string | null;
  suggestedAmounts: number[];
  minimumAmount: number | null;
  maximumAmount: number | null;
  allowRecurring?: boolean;
  allowPledges?: boolean;
}

interface StatementView {
  id: string;
  year: number;
  version: number;
  status: string;
  total: number;
}

interface PledgeView {
  id: string;
  fundId: string;
  fundName: string;
  campaignName: string | null;
  pledged: number;
  contributed: number;
  remainingTowardPledge: number;
  progressPercent: number;
  status: string;
}

interface ScheduleView {
  id: string;
  fundName: string;
  amount: number;
  frequency: string;
  status: string;
  nextContributionDate: string | null;
  paymentMethodDescriptor: string | null;
}

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every two weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually",
};

const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  PAYMENT_ACTION_REQUIRED: "Needs attention",
  PAYMENT_FAILED: "Payment issue",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

/** CORE-GIVE-B — Give Now + history. The server re-validates everything; the
 * redirect to Stripe never records the gift (the webhook does). */
export function MemberGiveNow({
  organizationId,
  terminology,
  funds,
  yearTotal,
  history,
  schedules = [],
  pledges = [],
  statements = [],
}: {
  organizationId: string;
  terminology: string;
  funds: FundView[];
  yearTotal: number;
  history: { id: string; contributionNumber: string | null; amount: number; date: string; designation: string }[];
  schedules?: ScheduleView[];
  pledges?: PledgeView[];
  statements?: StatementView[];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundId, setFundId] = useState(funds[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [frequency, setFrequency] = useState<string>("");
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [newAmount, setNewAmount] = useState("");
  const [newFrequency, setNewFrequency] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pledgeGivingId, setPledgeGivingId] = useState<string | null>(null);
  const [showPledgeForm, setShowPledgeForm] = useState(false);
  const [pledgeAmount, setPledgeAmount] = useState("");
  const [pledgeFundId, setPledgeFundId] = useState("");

  const fund = funds.find((row) => row.id === fundId) ?? null;

  async function giveNow() {
    const value = Number(amount);
    if (!fund || !Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/giving/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, fundId: fund.id, amount: value, memo: memo.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.url) {
        setError(data?.error || "Unable to start checkout.");
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }


  async function startRecurring() {
    const value = Number(amount);
    if (!fund || !Number.isFinite(value) || value <= 0 || !frequency) {
      setError("Choose an amount and a frequency.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/giving/recurring/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, fundId: fund.id, amount: value, frequency, confirmDuplicate }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.url) {
        if (res.status === 409 && !confirmDuplicate) setConfirmDuplicate(true);
        setError(data?.error || "Unable to start recurring giving.");
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function manage(scheduleId: string, body: Record<string, unknown>): Promise<boolean> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/giving/my-recurring/${scheduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to update your recurring giving.");
        return false;
      }
      return true;
    } catch {
      setError("Unable to connect. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function updatePaymentMethod(scheduleId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/giving/my-recurring/${scheduleId}/payment-method`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.url) {
        setError(data?.error || "Unable to open the payment-method update.");
        return;
      }
      window.location.href = data.url as string;
    } finally {
      setPending(false);
    }
  }

  async function giveTowardPledge(pledge: PledgeView) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount above, then press Give toward pledge.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/giving/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, fundId: pledge.fundId, amount: value, pledgeId: pledge.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.url) {
        setError(data?.error || "Unable to start checkout.");
        return;
      }
      window.location.href = data.url as string;
    } finally {
      setPending(false);
    }
  }

  async function createPledgeNow() {
    const value = Number(pledgeAmount);
    if (!pledgeFundId || !Number.isFinite(value) || value <= 0) {
      setError("Choose a fund and a pledge amount.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/giving/my-pledges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, fundId: pledgeFundId, pledgedAmount: value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to record your pledge.");
        return;
      }
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  async function generateMyStatement(year: number) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/giving/my-statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, year }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to prepare your statement.");
        return;
      }
      window.location.href = `/api/giving/statements/${data.data.id}/download`;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Give Now</h2>
        {funds.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No funds are open for online giving right now.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Fund</span>
              <select
                value={fundId}
                onChange={(event) => setFundId(event.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {funds.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            {fund?.description ? <p className="text-xs text-slate-500">{fund.description}</p> : null}
            {fund && fund.suggestedAmounts.length > 0 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested amounts">
                {fund.suggestedAmounts.map((suggested) => (
                  <button
                    key={suggested}
                    type="button"
                    onClick={() => setAmount(String(suggested))}
                    className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${
                      Number(amount) === suggested
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                    }`}
                  >
                    ${suggested}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Amount ($)</span>
              <input
                type="number"
                inputMode="decimal"
                min={fund?.minimumAmount ?? 1}
                max={fund?.maximumAmount ?? undefined}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base"
              />
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Note (optional)</span>
              <input
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                maxLength={200}
                placeholder="In honor of…"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={pending || !fund || !amount}
              onClick={giveNow}
              className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {pending ? "Opening secure checkout…" : "Continue to secure payment"}
            </button>
            <p className="text-xs text-slate-500">Card payments are processed by Stripe. Your card details never touch Unestra.</p>
          </div>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Recurring giving</h2>
        <p className="mt-1 text-xs text-slate-500">
          Give automatically on a schedule you choose. Recurring giving is voluntary: you can change, pause, or cancel it at
          any time, and stopping never creates a balance owed.
        </p>
        {fund && fund.allowRecurring !== false ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Frequency">
              {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFrequency(frequency === value ? "" : value)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                    frequency === value
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {frequency && amount && Number(amount) > 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                You are setting up{" "}
                <span className="font-semibold">
                  {money(Number(amount))} {FREQUENCY_LABELS[frequency].toLowerCase()}
                </span>{" "}
                to <span className="font-semibold">{fund.name}</span>, starting today. Your card is saved securely by Stripe
                for future contributions.
              </p>
            ) : null}
            <button
              type="button"
              disabled={pending || !fund || !amount || !frequency}
              onClick={startRecurring}
              className="w-full rounded-lg border border-emerald-700 bg-white px-4 py-3 text-base font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            >
              {confirmDuplicate ? "Yes, set up another schedule like this" : "Set up recurring giving"}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">This fund does not accept recurring contributions.</p>
        )}

        {schedules.length > 0 ? (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <h3 className="text-sm font-semibold text-slate-900">My recurring giving</h3>
            <ul className="mt-1 divide-y divide-slate-100">
              {schedules.map((schedule) => (
                <li key={schedule.id} className="py-2 text-sm">
                  <p className="font-medium text-slate-900">
                    {schedule.fundName} — {money(schedule.amount)}{" "}
                    {FREQUENCY_LABELS[schedule.frequency]?.toLowerCase() ?? schedule.frequency}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        schedule.status === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-800"
                          : schedule.status === "PAYMENT_FAILED" || schedule.status === "PAYMENT_ACTION_REQUIRED"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {SCHEDULE_STATUS_LABELS[schedule.status] ?? schedule.status}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {schedule.nextContributionDate
                      ? `Next contribution ${new Date(schedule.nextContributionDate).toLocaleDateString()}`
                      : "Schedule starting"}
                    {schedule.paymentMethodDescriptor ? ` · ${schedule.paymentMethodDescriptor}` : ""}
                  </p>
                  {schedule.status === "PAYMENT_FAILED" || schedule.status === "PAYMENT_ACTION_REQUIRED" ? (
                    <p className="text-xs font-medium text-amber-700">
                      Your contribution could not be processed. This is not a balance owed — update your payment method or
                      try again below.
                    </p>
                  ) : null}
                  {schedule.status !== "CANCELLED" && schedule.status !== "COMPLETED" ? (
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setManageId(manageId === schedule.id ? null : schedule.id);
                          setNewAmount(String(schedule.amount));
                          setNewFrequency(schedule.frequency);
                          setConfirmCancel(false);
                          setCancelReason("");
                        }}
                        className="text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        {manageId === schedule.id ? "Close" : "Manage"}
                      </button>
                    </div>
                  ) : null}
                  {manageId === schedule.id ? (
                    <div className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="space-y-1 text-xs font-semibold text-slate-700">
                          <span>Amount ($)</span>
                          <input
                            type="number"
                            min={1}
                            step="0.01"
                            value={newAmount}
                            onChange={(event) => setNewAmount(event.target.value)}
                            className="block w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={pending || Number(newAmount) === schedule.amount || !(Number(newAmount) > 0)}
                          onClick={async () => {
                            if (await manage(schedule.id, { action: "amount", amount: Number(newAmount) })) {
                              setNotice("New amount saved — it applies starting with your next scheduled contribution.");
                              setTimeout(() => window.location.reload(), 1200);
                            }
                          }}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Change amount
                        </button>
                        <label className="space-y-1 text-xs font-semibold text-slate-700">
                          <span>Frequency</span>
                          <select
                            value={newFrequency}
                            onChange={(event) => setNewFrequency(event.target.value)}
                            className="block w-40 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                          >
                            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          disabled={pending || newFrequency === schedule.frequency}
                          onClick={async () => {
                            if (await manage(schedule.id, { action: "frequency", frequency: newFrequency })) {
                              setNotice("Frequency saved — your next contribution date is unchanged; the new rhythm applies after it.");
                              setTimeout(() => window.location.reload(), 1200);
                            }
                          }}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Change frequency
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => updatePaymentMethod(schedule.id)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Update payment method
                        </button>
                        {schedule.status === "PAYMENT_FAILED" || schedule.status === "PAYMENT_ACTION_REQUIRED" ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={async () => {
                              if (await manage(schedule.id, { action: "retry" })) {
                                setNotice("Payment attempted — your history updates once it settles.");
                                setTimeout(() => window.location.reload(), 1500);
                              }
                            }}
                            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                          >
                            Try again
                          </button>
                        ) : null}
                        {schedule.status === "PAUSED" ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={async () => {
                              if (await manage(schedule.id, { action: "resume" })) window.location.reload();
                            }}
                            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                          >
                            Resume
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={async () => {
                              if (await manage(schedule.id, { action: "pause" })) window.location.reload();
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                          >
                            Pause
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => setConfirmCancel((value) => !value)}
                          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Cancel giving
                        </button>
                      </div>
                      {confirmCancel ? (
                        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                          <p className="text-xs text-red-900">
                            You are cancelling {money(schedule.amount)}{" "}
                            {FREQUENCY_LABELS[schedule.frequency]?.toLowerCase() ?? schedule.frequency} to {schedule.fundName}. No
                            future contribution will be scheduled. Your giving history stays available.
                          </p>
                          <select
                            value={cancelReason}
                            onChange={(event) => setCancelReason(event.target.value)}
                            className="block w-64 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                          >
                            <option value="">Reason (optional)</option>
                            <option value="financial_circumstances">Financial circumstances</option>
                            <option value="changing_amount">Changing amount</option>
                            <option value="switching_frequency">Switching frequency</option>
                            <option value="prefer_manual_giving">I prefer to give manually</option>
                            <option value="no_longer_participating">No longer participating</option>
                            <option value="other">Other</option>
                            <option value="prefer_not_to_say">Prefer not to say</option>
                          </select>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={async () => {
                              if (await manage(schedule.id, { action: "cancel", reason: cancelReason || null })) window.location.reload();
                            }}
                            className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                          >
                            Confirm cancellation
                          </button>
                        </div>
                      ) : null}
                      {notice ? <p className="text-xs font-medium text-emerald-700">{notice}</p> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {(pledges.length > 0 || funds.some((row) => row.allowPledges)) ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">My Pledges</h2>
          <p className="mt-1 text-xs text-slate-500">
            A pledge is your stated giving intention — progress tracks what you have given toward it. It is never a balance
            owed.
          </p>
          {pledges.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No pledges yet.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {pledges.map((pledge) => (
                <li key={pledge.id} className="rounded-lg border border-slate-100 p-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {pledge.fundName}
                    {pledge.campaignName ? <span className="ml-1 text-xs font-normal text-slate-500">({pledge.campaignName})</span> : null}
                    {pledge.status === "FULFILLED" ? (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Fulfilled</span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    Pledged {money(pledge.pledged)} · Given {money(pledge.contributed)} ·{" "}
                    <span className="font-semibold">Remaining toward pledge: {money(pledge.remainingTowardPledge)}</span>
                  </p>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-emerald-600" style={{ width: `${pledge.progressPercent}%` }} />
                  </div>
                  {pledge.status === "ACTIVE" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => setPledgeGivingId(pledgeGivingId === pledge.id ? null : pledge.id)}
                        className="rounded-lg border border-emerald-700 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        Give toward pledge
                      </button>
                      {pledgeGivingId === pledge.id ? (
                        <span className="flex items-center gap-2 text-xs text-slate-600">
                          Uses the amount entered in Give Now above →
                          <button
                            type="button"
                            disabled={pending || !amount}
                            onClick={() => giveTowardPledge(pledge)}
                            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                          >
                            Continue to payment
                          </button>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {funds.some((row) => row.allowPledges) ? (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setShowPledgeForm((value) => !value)}
                className="text-xs font-semibold text-emerald-700 hover:underline"
              >
                {showPledgeForm ? "Close" : "Make a pledge"}
              </button>
              {showPledgeForm ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="space-y-1 text-xs font-semibold text-slate-700">
                    <span>Fund</span>
                    <select
                      value={pledgeFundId}
                      onChange={(event) => setPledgeFundId(event.target.value)}
                      className="block w-48 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="">Choose…</option>
                      {funds
                        .filter((row) => row.allowPledges)
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-slate-700">
                    <span>Pledge amount ($)</span>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={pledgeAmount}
                      onChange={(event) => setPledgeAmount(event.target.value)}
                      className="block w-32 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={pending || !pledgeFundId || !(Number(pledgeAmount) > 0)}
                    onClick={createPledgeNow}
                    className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    Record my pledge
                  </button>
                  <p className="w-full text-xs text-slate-500">
                    A pledge states your intention — it never creates a balance owed, and you can cancel it any time.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-slate-900">My {terminology}</h2>
          <p className="text-sm text-slate-600">
            {new Date().getFullYear()}: <span className="font-semibold text-slate-900">{money(yearTotal)}</span>
          </p>
        </div>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No contributions yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {history.map((row) => (
              <li key={row.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-800">
                  {new Date(row.date).toLocaleDateString()} — {row.designation}
                  {row.contributionNumber ? <span className="ml-2 font-mono text-xs text-slate-400">{row.contributionNumber}</span> : null}
                </span>
                <span className="font-semibold text-slate-900">{money(row.amount)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-slate-100 pt-3">
          <h3 className="text-sm font-semibold text-slate-900">Statements</h3>
          {statements.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">No statements yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100">
              {statements.map((statement) => (
                <li key={statement.id} className="flex items-center justify-between py-2 text-sm">
                  <span className={statement.status === "SUPERSEDED" ? "text-slate-400" : "text-slate-800"}>
                    {statement.year} Contribution Statement · v{statement.version}
                    {statement.status === "SUPERSEDED" ? " (superseded)" : ""} — {money(statement.total)}
                  </span>
                  <a
                    href={`/api/giving/statements/${statement.id}/download`}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => generateMyStatement(new Date().getFullYear() - (new Date().getMonth() === 0 ? 1 : 0))}
            className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
          >
            Prepare my current statement
          </button>
          <p className="mt-1 text-xs text-slate-500">A statement is a record of contributions received — consult your organization regarding tax treatment.</p>
        </div>
      </section>
    </div>
  );
}
