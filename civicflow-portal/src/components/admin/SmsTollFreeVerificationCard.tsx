"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type VerificationStatus = "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";

const STATUS_STYLES: Record<VerificationStatus, string> = {
  NOT_SUBMITTED: "bg-slate-100 text-slate-700",
  PENDING: "bg-amber-100 text-amber-800",
  VERIFIED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
};

const STATUS_LABEL: Record<VerificationStatus, string> = {
  NOT_SUBMITTED: "Not Submitted",
  PENDING: "Pending",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

export function SmsTollFreeVerificationCard({
  status,
  submittedAt,
  approvedAt,
  lastCheckedAt,
  lastCheckedLabel,
}: {
  status: VerificationStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  lastCheckedAt: string | null;
  lastCheckedLabel: string;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sms/toll-free-verification/refresh", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to refresh verification status.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLES[status]}`}>{STATUS_LABEL[status]}</span>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
        >
          {refreshing ? "Refreshing..." : "Refresh Status"}
        </button>
      </div>

      <dl className="grid gap-3 text-sm md:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted Date</dt>
          <dd className="text-slate-900">{submittedAt ? new Date(submittedAt).toLocaleDateString() : "Not on file"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approval Date</dt>
          <dd className="text-slate-900">{approvedAt ? new Date(approvedAt).toLocaleDateString() : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last Checked</dt>
          <dd className="text-slate-900">{lastCheckedAt ? lastCheckedLabel : "Never"}</dd>
        </div>
      </dl>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </div>
  );
}
