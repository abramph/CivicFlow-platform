"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DuesPaymentMethod } from "@prisma/client";
import { getPaymentMethodCategory } from "@/lib/payment-method-links";

type Campaign = { id: string; name: string };
type Event = { id: string; title: string };
type PaymentMethod = { id: string; method: DuesPaymentMethod; label: string };

const categoryLabels: Record<ReturnType<typeof getPaymentMethodCategory>, string> = {
  native: "Online card payment",
  external: "External redirect",
  offline: "Offline instructions",
};

type PaymentLinkFormProps = {
  mode: "create" | "edit";
  campaigns: Campaign[];
  events: Event[];
  paymentMethods: PaymentMethod[];
  link?: {
    id: string;
    title: string;
    description: string | null;
    linkType: string;
    amount: string | null;
    minAmount: string | null;
    campaignId: string | null;
    eventId: string | null;
    status: string;
    expiresAt: string | null;
    paymentMethodConfigIds?: string[];
  };
};

const fieldClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export function PaymentLinkForm({ mode, campaigns, events, paymentMethods, link }: PaymentLinkFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: link?.title ?? "",
    description: link?.description ?? "",
    linkType: link?.linkType ?? "GENERAL",
    amount: link?.amount ?? "",
    minAmount: link?.minAmount ?? "",
    campaignId: link?.campaignId ?? "",
    eventId: link?.eventId ?? "",
    status: link?.status ?? "active",
    expiresAt: link?.expiresAt ? link.expiresAt.slice(0, 10) : "",
  });
  const [selectedMethodIds, setSelectedMethodIds] = useState<string[]>(
    link?.paymentMethodConfigIds ??
      (paymentMethods.find((m) => m.method === "STRIPE") ? [paymentMethods.find((m) => m.method === "STRIPE")!.id] : [])
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMethod(id: string) {
    setSelectedMethodIds((ids) => (ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id]));
  }

  function field(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const amount = form.amount.trim() ? Number(form.amount.trim()) : null;
    const minAmount = form.minAmount.trim() ? Number(form.minAmount.trim()) : null;

    if (form.amount.trim() && (Number.isNaN(amount) || (amount ?? 0) <= 0)) {
      setSaving(false);
      setError("Amount must be a positive number.");
      return;
    }

    if (selectedMethodIds.length === 0) {
      setSaving(false);
      setError("Select at least one payment method.");
      return;
    }

    try {
      const response = await fetch(
        mode === "create" ? "/api/payment-links" : `/api/payment-links/${link?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.title.trim(),
            description: form.description.trim() || null,
            linkType: form.linkType,
            amount,
            minAmount,
            campaignId: form.campaignId || null,
            eventId: form.eventId || null,
            status: form.status,
            expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
            paymentMethodConfigIds: selectedMethodIds,
          }),
        }
      );

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { id?: string } }
        | null;

      if (!response.ok || !payload?.ok || !payload.data?.id) {
        setError(payload?.error ?? "Failed to save the payment link.");
        return;
      }

      router.push(`/payment-links/${payload.data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the payment link.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
          <span>Title <span className="text-red-600">*</span></span>
          <input
            required
            className={fieldClassName}
            value={form.title}
            onChange={field("title")}
            placeholder="e.g. Annual Fund Drive"
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Type</span>
          <select className={fieldClassName} value={form.linkType} onChange={field("linkType")}>
            <option value="GENERAL">General</option>
            <option value="CAMPAIGN">Campaign</option>
            <option value="EVENT">Event</option>
            <option value="DUES">Dues</option>
          </select>
        </label>

        {mode === "edit" && (
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Status</span>
            <select className={fieldClassName} value={form.status} onChange={field("status")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        )}

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Fixed amount (leave blank to let payer choose)</span>
          <input
            type="number"
            min="1"
            step="0.01"
            className={fieldClassName}
            value={form.amount}
            onChange={field("amount")}
            placeholder="e.g. 25.00"
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Minimum amount (for flexible links)</span>
          <input
            type="number"
            min="1"
            step="0.01"
            className={fieldClassName}
            value={form.minAmount}
            onChange={field("minAmount")}
            placeholder="e.g. 5.00"
          />
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Attribute to campaign</span>
          <select className={fieldClassName} value={form.campaignId} onChange={field("campaignId")}>
            <option value="">— none —</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Attribute to event</span>
          <select className={fieldClassName} value={form.eventId} onChange={field("eventId")}>
            <option value="">— none —</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.title}</option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Expires on</span>
          <input
            type="date"
            className={fieldClassName}
            value={form.expiresAt}
            onChange={field("expiresAt")}
          />
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-900">
          Payment methods <span className="text-red-600">*</span>
        </p>
        {paymentMethods.length === 0 ? (
          <p className="text-sm text-slate-600">
            No active payment methods are configured for your organization yet. Configure at least one under
            organization settings before creating a link.
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {paymentMethods.map((m) => {
              const checked = selectedMethodIds.includes(m.id);
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    checked ? "border-emerald-600 bg-emerald-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleMethod(m.id)} />
                  <span className="font-medium text-slate-900">{m.label}</span>
                  <span className="ml-auto text-xs text-slate-500">{categoryLabels[getPaymentMethodCategory(m.method)]}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Description</span>
        <textarea
          rows={4}
          className={fieldClassName}
          value={form.description}
          onChange={field("description")}
          placeholder="Optional message shown on the payment page."
        />
      </label>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "Saving..." : mode === "create" ? "Create link" : "Save changes"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() =>
            router.push(link?.id ? `/payment-links/${link.id}` : "/payment-links")
          }
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
