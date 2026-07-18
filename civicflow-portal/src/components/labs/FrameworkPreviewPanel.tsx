"use client";

import { useState } from "react";

export function FrameworkPreviewPanel() {
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function recordUsage() {
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/labs/framework-preview/record-usage", { method: "POST" });
      const data = await res.json().catch(() => null);
      setResult(res.ok && data?.ok ? "Usage event recorded." : data?.error || "Unable to record usage.");
    } catch {
      setResult("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
      <p className="text-sm font-semibold text-emerald-900">Framework preview panel</p>
      <p className="mt-1 text-sm text-emerald-800">
        You are seeing this because your organization is enrolled in the internal-only{" "}
        <code className="rounded bg-emerald-100 px-1">labsFrameworkPreview</code> feature and you hold a role with
        Labs read permission. This panel contains no AI functionality and makes no customer-visible product claim —
        it exists only to prove the enrollment + entitlement + permission chain works end to end.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={recordUsage}
        className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Recording..." : "Record a test usage event"}
      </button>
      {result ? <p className="mt-2 text-sm text-emerald-900">{result}</p> : null}
    </div>
  );
}
