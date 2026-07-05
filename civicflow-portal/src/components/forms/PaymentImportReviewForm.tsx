"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

type Option = { id: string; label: string };
type Item = {
  id: string;
  matchedMemberId: string | null;
  matchedDuesChargeId: string | null;
  matchedCampaignId: string | null;
  matchedEventId: string | null;
  verificationStatus: string;
};

export function PaymentImportReviewForm({
  batchId,
  item,
  members,
  charges,
  campaigns,
  events,
  canWrite,
}: {
  batchId: string;
  item: Item;
  members: Option[];
  charges: Option[];
  campaigns: Option[];
  events: Option[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    matchedMemberId: item.matchedMemberId ?? "",
    matchedDuesChargeId: item.matchedDuesChargeId ?? "",
    matchedCampaignId: item.matchedCampaignId ?? "",
    matchedEventId: item.matchedEventId ?? "",
    verificationStatus: item.verificationStatus === "POSTED" ? "VERIFIED" : item.verificationStatus,
    postedAs: "DUES_PAYMENT",
    receiptRequested: false,
  });
  const [message, setMessage] = useState<string | null>(null);

  if (!canWrite) {
    return <p className="text-sm text-slate-700">You have read-only access to this import item.</p>;
  }

  async function saveReview() {
    const response = await fetch(`/api/payments/imports/${batchId}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setMessage(payload?.ok ? "Saved" : payload?.error || "Failed to save");
    router.refresh();
  }

  async function postItem() {
    const response = await fetch(`/api/payments/imports/${batchId}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    setMessage(payload?.ok ? "Posted" : payload?.error || "Failed to post");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        <select className={fieldClassName} value={form.matchedMemberId} onChange={(event) => setForm((current) => ({ ...current, matchedMemberId: event.target.value }))}>
          <option value="">No member</option>
          {members.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select className={fieldClassName} value={form.matchedDuesChargeId} onChange={(event) => setForm((current) => ({ ...current, matchedDuesChargeId: event.target.value }))}>
          <option value="">No charge</option>
          {charges.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select className={fieldClassName} value={form.matchedCampaignId} onChange={(event) => setForm((current) => ({ ...current, matchedCampaignId: event.target.value }))}>
          <option value="">No campaign</option>
          {campaigns.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select className={fieldClassName} value={form.matchedEventId} onChange={(event) => setForm((current) => ({ ...current, matchedEventId: event.target.value }))}>
          <option value="">No event</option>
          {events.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select className={fieldClassName} value={form.verificationStatus} onChange={(event) => setForm((current) => ({ ...current, verificationStatus: event.target.value }))}>
          <option value="PENDING_REVIEW">Pending</option>
          <option value="VERIFIED">Verified</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <select className={fieldClassName} value={form.postedAs} onChange={(event) => setForm((current) => ({ ...current, postedAs: event.target.value }))}>
          <option value="DUES_PAYMENT">Post as dues</option>
          <option value="CONTRIBUTION">Post as contribution</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input type="checkbox" checked={form.receiptRequested} onChange={(event) => setForm((current) => ({ ...current, receiptRequested: event.target.checked }))} />
          Receipt requested
        </label>
        <button type="button" onClick={saveReview} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-900">Save Review</button>
        <button type="button" onClick={postItem} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Post Verified</button>
        {message ? <span className="text-xs text-slate-700">{message}</span> : null}
      </div>
    </div>
  );
}
