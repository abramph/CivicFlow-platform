"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName, helperTextClassName } from "@/components/forms/formStyles";
import { formatCurrency, formatDate, formatDateTime, formatEnumLabel } from "@/lib/formatting";

type ContributionOption = {
  id: string;
  contributionDate: string;
  amount: string;
  paymentMethodLabel: string | null;
  member: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
  } | null;
};

type ReceiptRow = {
  id: string;
  receiptNumber: string;
  deliveryStatus: string;
  deliveredAt: string | null;
  createdAt: string;
  memberName: string | null;
  contributionAmount: string;
  attachmentId: string | null;
};

export function ReceiptsManager({
  contributions,
  receipts,
  canWrite,
}: {
  contributions: ContributionOption[];
  receipts: ReceiptRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    contributionId: contributions[0]?.id ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedContribution = useMemo(
    () => contributions.find((contribution) => contribution.id === form.contributionId) ?? null,
    [contributions, form.contributionId]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/receipts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contributionId: form.contributionId,
          memberId: selectedContribution?.member?.id ?? null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to issue the receipt.");
        return;
      }

      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to issue the receipt."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {canWrite ? (
      <form className="grid gap-4 md:grid-cols-3" onSubmit={handleSubmit}>
        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-3">
          <span>Contribution</span>
          <select
            value={form.contributionId}
            onChange={(event) => setForm((current) => ({ ...current, contributionId: event.target.value }))}
            className={fieldClassName}
          >
            {contributions.map((contribution) => (
              <option key={contribution.id} value={contribution.id}>
            {formatDate(contribution.contributionDate)} · {formatCurrency(contribution.amount)} · {contribution.member ? `${contribution.member.lastName}, ${contribution.member.firstName}` : "No member"}
                {contribution.paymentMethodLabel ? ` · ${contribution.paymentMethodLabel}` : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="md:col-span-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          <p className="font-semibold text-slate-950">Selected contribution</p>
          <p className="mt-1">
            {selectedContribution
              ? `${formatDate(selectedContribution.contributionDate)} · ${formatCurrency(selectedContribution.amount)} · ${selectedContribution.member ? `${selectedContribution.member.firstName} ${selectedContribution.member.lastName}` : "No member"}${selectedContribution.paymentMethodLabel ? ` · ${selectedContribution.paymentMethodLabel}` : ""}`
              : "Select a contribution to issue a receipt."}
          </p>
          <p className={`mt-1 ${helperTextClassName}`}>
            When the member has an email address, the receipt workflow will also attempt email delivery.
          </p>
        </div>

        {error ? (
          <div className="md:col-span-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="md:col-span-3">
          <button
            type="submit"
            disabled={saving || !form.contributionId}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {saving ? "Issuing..." : "Issue Receipt"}
          </button>
        </div>
      </form>
      ) : (
        <p className="text-sm text-slate-700">You have read-only access to receipts.</p>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3">Receipt #</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Contribution</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Delivered</th>
              <th className="px-4 py-3">File</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-600">
                  No contribution receipts have been issued yet.
                </td>
              </tr>
            ) : (
              receipts.map((receipt) => (
                <tr key={receipt.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">{receipt.receiptNumber}</td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(receipt.deliveryStatus)}</td>
                  <td className="px-4 py-3 text-slate-900">{receipt.memberName ?? "No member"}</td>
                  <td className="px-4 py-3 text-slate-900">{formatCurrency(receipt.contributionAmount)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(receipt.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(receipt.deliveredAt)}</td>
                  <td className="px-4 py-3 text-slate-900">
                    {receipt.attachmentId ? (
                      <a href={`/api/attachments/${receipt.attachmentId}/download`} className="text-emerald-700 hover:underline">Download</a>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
